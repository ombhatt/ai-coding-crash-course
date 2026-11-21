import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { seedDatabase, DROP_OFF_CLIFFS } from "./seed-data";

// The seed is QA data for the analytics dashboard: these tests pin the shapes
// a working dashboard must show, so a broken one is visibly different.

let db: ReturnType<typeof createTestDb>;
let summary: ReturnType<typeof seedDatabase>;

beforeAll(() => {
  db = createTestDb();
  summary = seedDatabase(db);
});

function cutoff(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function revenueSince(iso: string | null) {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${schema.purchases.amountPaid}), 0)` })
    .from(schema.purchases)
    .where(iso ? sql`${schema.purchases.createdAt} >= ${iso}` : undefined)
    .get();
  return row!.total;
}

describe("seedDatabase", () => {
  it("gives distinct, non-zero revenue for 7d, 30d, 90d and all time", () => {
    const d7 = revenueSince(cutoff(7));
    const d30 = revenueSince(cutoff(30));
    const d90 = revenueSince(cutoff(90));
    const all = revenueSince(null);

    expect(d7).toBeGreaterThan(0);
    expect(d30).toBeGreaterThan(d7);
    expect(d90).toBeGreaterThan(d30);
    expect(all).toBeGreaterThan(d90);
  });

  it("has an instructor with no courses, so the empty state is reachable", () => {
    const idle = db.all<{ id: number }>(sql`
      select u.id from users u
      where u.role = 'instructor'
        and not exists (select 1 from courses c where c.instructor_id = u.id)
    `);
    expect(idle).toHaveLength(1);
  });

  it("has a draft course and a published course with zero sales", () => {
    const draft = db.all(sql`select id from courses where status = 'draft'`);
    const unsold = db.all(sql`
      select c.id from courses c
      where c.status = 'published'
        and not exists (select 1 from purchases p where p.course_id = c.id)
    `);
    expect(draft).toHaveLength(1);
    expect(unsold).toHaveLength(1);
  });

  it("has 4–5 courses across 3 instructors", () => {
    const { courses, instructors } = db.get<{ courses: number; instructors: number }>(sql`
      select count(*) as courses, count(distinct instructor_id) as instructors from courses
    `)!;
    expect(courses).toBeGreaterThanOrEqual(4);
    expect(courses).toBeLessThanOrEqual(5);
    expect(instructors).toBe(3);
  });

  /** Completed-lesson counts for a course, in course order. */
  function funnel(courseSlug: string) {
    return db.all<{ title: string; completed: number }>(sql`
      select l.title,
        (select count(*) from lesson_progress lp
          where lp.lesson_id = l.id and lp.status = 'completed') as completed
      from lessons l
      join modules m on m.id = l.module_id
      join courses c on c.id = m.course_id
      where c.slug = ${courseSlug}
      order by m.position, l.position
    `);
  }

  it.each(DROP_OFF_CLIFFS)(
    "plants the steepest drop-off in $courseSlug at \"$lessonTitle\"",
    ({ courseSlug, lessonTitle }) => {
      const steps = funnel(courseSlug);
      expect(steps.every((s) => s.completed > 0)).toBe(true);
      const retention = steps
        .slice(1)
        .map((step, i) => ({ title: step.title, kept: step.completed / steps[i].completed }));
      const steepest = retention.reduce((a, b) => (b.kept < a.kept ? b : a));

      expect(steepest.title).toBe(lessonTitle);
      expect(steepest.kept).toBeLessThanOrEqual(0.5);
    }
  );

  it("documents a cliff for every course that has sales", () => {
    const sold = db.all<{ slug: string }>(sql`
      select distinct c.slug from courses c join purchases p on p.course_id = c.id
    `);
    expect(DROP_OFF_CLIFFS.map((c) => c.courseSlug).sort()).toEqual(
      sold.map((c) => c.slug).sort()
    );
  });

  it("records watch events only with types the video player emits", () => {
    // youtube-player.tsx sends play, pause, ended, and a "progress" heartbeat.
    const types = db
      .all<{ eventType: string }>(sql`select distinct event_type as eventType from video_watch_events`)
      .map((r) => r.eventType)
      .sort();
    expect(types).toEqual(["ended", "pause", "play", "progress"]);
  });

  it("spaces progress heartbeats 10 seconds apart, like the player", () => {
    const gaps = db.all<{ gap: number }>(sql`
      select round(position_seconds - lag(position_seconds) over (
        partition by user_id, lesson_id order by created_at, id
      )) as gap
      from video_watch_events where event_type = 'progress'
    `);
    const measured = gaps.filter((g) => g.gap !== null);
    expect(measured.length).toBeGreaterThan(0);
    expect(measured.every((g) => g.gap === 10)).toBe(true);
  });

  it.each([
    ["purchases", "created_at"],
    ["enrollments", "enrolled_at"],
    ["lesson_progress", "completed_at"],
    ["video_watch_events", "created_at"],
  ])("has %s rows within the last 7 days", (table, column) => {
    const row = db.get<{ n: number }>(
      sql`select count(*) as n from ${sql.identifier(table)} where ${sql.identifier(column)} >= ${cutoff(7)}`
    )!;
    expect(row.n).toBeGreaterThan(0);
  });

  it("has several team purchases whose seats are only partly redeemed", () => {
    const teams = db.all<{ seats: number; redeemed: number }>(sql`
      select count(*) as seats, count(redeemed_by_user_id) as redeemed
      from coupons group by purchase_id
    `);
    const partly = teams.filter((t) => t.redeemed > 0 && t.redeemed < t.seats);
    expect(partly.length).toBeGreaterThanOrEqual(2);
  });

  it("enrolls every coupon redeemer in the coupon's course", () => {
    const orphans = db.all(sql`
      select c.id from coupons c
      where c.redeemed_by_user_id is not null
        and not exists (
          select 1 from enrollments e
          where e.user_id = c.redeemed_by_user_id and e.course_id = c.course_id
        )
    `);
    expect(orphans).toEqual([]);
  });

  it("reports a summary derived from the rows it wrote", () => {
    // Known-good values from the planned shape: 5 courses, 3 team purchases on
    // top of 54 individual ones, 17 seats of which 8 are redeemed.
    expect(summary.rowCounts.courses).toBe(5);
    expect(summary.rowCounts.teams).toBe(3);
    expect(summary.rowCounts.purchases).toBe(57);
    expect(summary.usersByRole).toEqual({ admin: 1, instructor: 4, student: 42 });
    expect(summary.coupons).toEqual({ redeemed: 8, available: 9 });
  });


  it("keeps purchases clear of window edges, so day-rounded cutoffs agree", () => {
    const ages = db
      .all<{ createdAt: string }>(sql`select created_at as createdAt from purchases`)
      .map((p) => (Date.now() - Date.parse(p.createdAt)) / (24 * 60 * 60 * 1000));
    for (const edge of [7, 30, 90]) {
      expect(ages.filter((age) => Math.abs(age - edge) < 1.5), `near ${edge}d`).toEqual([]);
    }
  });

  it("spans about 12 months of purchase history", () => {
    const earliest = db
      .select({ at: sql<string>`min(${schema.purchases.createdAt})` })
      .from(schema.purchases)
      .get()!.at;
    expect(earliest < cutoff(300)).toBe(true);
  });
});
