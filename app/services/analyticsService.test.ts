import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { ANALYTICS_RANGES } from "~/lib/analytics";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  getRevenueSeries,
  getRevenueSummary,
  hasPublishedCourses,
} from "./analyticsService";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function addInstructor(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Instructor })
    .returning()
    .get();
}

function addCourse(instructorId: number, slug: string) {
  return testDb
    .insert(schema.courses)
    .values({
      title: slug,
      slug,
      description: slug,
      salesCopy: slug,
      instructorId,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function addPurchase(
  courseId: number,
  amountPaid: number,
  createdAt = daysAgo(1)
) {
  testDb
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId, amountPaid, createdAt })
    .run();
}

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getRevenueSummary", () => {
  it("counts only purchases of the instructor's own courses", () => {
    const other = addInstructor("other@example.com");
    const otherCourse = addCourse(other.id, "other-course");
    const secondOwnCourse = addCourse(base.instructor.id, "second-course");

    addPurchase(base.course.id, 5000);
    addPurchase(secondOwnCourse.id, 3000);
    addPurchase(otherCourse.id, 9000);

    expect(getRevenueSummary(base.instructor.id, "all").gross).toBe(8000);
    expect(getRevenueSummary(other.id, "all").gross).toBe(9000);
  });

  it("splits gross into the platform's 20% fee and the instructor's net", () => {
    addPurchase(base.course.id, 5000);
    addPurchase(base.course.id, 2500);

    expect(getRevenueSummary(base.instructor.id, "all")).toEqual({
      gross: 7500,
      fee: 1500,
      net: 6000,
    });
  });

  it("rounds the fee to whole cents, and net absorbs the remainder", () => {
    // 20% of $49.99 is 999.8 cents.
    addPurchase(base.course.id, 4999);

    expect(getRevenueSummary(base.instructor.id, "all")).toEqual({
      gross: 4999,
      fee: 1000,
      net: 3999,
    });
  });

  it("rounds once on the total, not per purchase", () => {
    // Three $0.02 sales: per-purchase rounding gives a fee of 0 (0.4 → 0, three
    // times); on the 6-cent total it is 1.2 → 1.
    addPurchase(base.course.id, 2);
    addPurchase(base.course.id, 2);
    addPurchase(base.course.id, 2);

    expect(getRevenueSummary(base.instructor.id, "all")).toEqual({
      gross: 6,
      fee: 1,
      net: 5,
    });
  });

  it.each([
    ["7d", 1],
    ["30d", 1 + 20],
    ["90d", 1 + 20 + 300],
    ["all", 1 + 20 + 300 + 4000],
  ] as const)("limits %s to purchases inside the window", (range, expected) => {
    addPurchase(base.course.id, 1, daysAgo(3));
    addPurchase(base.course.id, 20, daysAgo(20));
    addPurchase(base.course.id, 300, daysAgo(60));
    addPurchase(base.course.id, 4000, daysAgo(200));

    expect(getRevenueSummary(base.instructor.id, range).gross).toBe(expected);
  });

  it("includes a purchase exactly on the cutoff, and excludes one a moment before", () => {
    // On the seed data the largest sale once sat right on the 30-day edge, and
    // inclusive-vs-exclusive swung 30-day revenue 6x. The window is inclusive.
    const cutoff = NOW.getTime() - 30 * DAY_MS;
    addPurchase(base.course.id, 600, new Date(cutoff).toISOString());
    addPurchase(base.course.id, 7, new Date(cutoff - 1).toISOString());

    expect(getRevenueSummary(base.instructor.id, "30d").gross).toBe(600);
  });
});

describe("an instructor with nothing yet", () => {
  it("gets zeroed revenue rather than a throw or NaN", () => {
    const idle = addInstructor("idle@example.com");

    for (const range of ["7d", "30d", "90d", "all"] as const) {
      expect(getRevenueSummary(idle.id, range)).toEqual({
        gross: 0,
        fee: 0,
        net: 0,
      });
    }
  });
});

describe("hasPublishedCourses", () => {
  it("is false for an instructor with no courses", () => {
    expect(hasPublishedCourses(addInstructor("idle@example.com").id)).toBe(
      false
    );
  });

  it("is false when the instructor's only course is a draft", () => {
    const drafter = addInstructor("drafter@example.com");
    const draft = addCourse(drafter.id, "draft-course");
    testDb
      .update(schema.courses)
      .set({ status: schema.CourseStatus.Draft })
      .where(eq(schema.courses.id, draft.id))
      .run();

    expect(hasPublishedCourses(drafter.id)).toBe(false);
  });

  it("is true once a course is published, even with no sales", () => {
    expect(hasPublishedCourses(base.instructor.id)).toBe(true);
  });
});

describe("getRevenueSeries", () => {
  // NOW is Monday 2026-06-15, 12:00 UTC.

  it("buckets 30 days by calendar day, zero-filling quiet days", () => {
    addPurchase(base.course.id, 500, "2026-06-15T09:00:00.000Z");
    addPurchase(base.course.id, 250, "2026-06-15T01:00:00.000Z");
    addPurchase(base.course.id, 100, "2026-06-13T23:59:59.000Z");

    const series = getRevenueSeries(base.instructor.id, "30d");

    expect(series.granularity).toBe("day");
    // From the day holding the cutoff (May 16, 12:00) through today.
    expect(series.points).toHaveLength(31);
    expect(series.points[0]).toEqual({ start: "2026-05-16", gross: 0 });
    expect(series.points.slice(-3)).toEqual([
      { start: "2026-06-13", gross: 100 },
      { start: "2026-06-14", gross: 0 },
      { start: "2026-06-15", gross: 750 },
    ]);
  });

  it.each(ANALYTICS_RANGES)(
    "sums its %s buckets to the gross revenue for that range",
    (range) => {
      addPurchase(base.course.id, 1, daysAgo(0.1));
      addPurchase(base.course.id, 20, daysAgo(6.9));
      // Exactly on the 30-day cutoff: inside the window, so inside a bucket.
      addPurchase(base.course.id, 300, daysAgo(30));
      addPurchase(base.course.id, 4000, daysAgo(85));
      addPurchase(base.course.id, 50000, daysAgo(400));

      const total = getRevenueSeries(base.instructor.id, range).points.reduce(
        (sum, point) => sum + point.gross,
        0
      );
      expect(total).toBe(getRevenueSummary(base.instructor.id, range).gross);
    }
  );

  it("buckets 90 days into weeks starting on Monday", () => {
    addPurchase(base.course.id, 700, "2026-06-14T18:00:00.000Z"); // Sunday
    addPurchase(base.course.id, 30, "2026-06-08T00:00:00.000Z"); // Monday

    const series = getRevenueSeries(base.instructor.id, "90d");

    expect(series.granularity).toBe("week");
    // Cutoff is Tue 2026-03-17, in the week starting Mon 2026-03-16.
    expect(series.points[0].start).toBe("2026-03-16");
    expect(series.points).toHaveLength(14);
    expect(series.points.slice(-2)).toEqual([
      { start: "2026-06-08", gross: 730 },
      { start: "2026-06-15", gross: 0 },
    ]);
  });

  it("buckets all time into months from the first sale to now", () => {
    addPurchase(base.course.id, 900, "2026-03-31T23:00:00.000Z");
    addPurchase(base.course.id, 80, "2026-05-01T00:00:00.000Z");

    expect(getRevenueSeries(base.instructor.id, "all")).toEqual({
      granularity: "month",
      points: [
        { start: "2026-03-01", gross: 900 },
        { start: "2026-04-01", gross: 0 },
        { start: "2026-05-01", gross: 80 },
        { start: "2026-06-01", gross: 0 },
      ],
    });
  });

  it("is empty when nothing sold in the range, so the panel can say so", () => {
    addPurchase(base.course.id, 900, daysAgo(40));

    expect(getRevenueSeries(base.instructor.id, "30d").points).toEqual([]);
    expect(
      getRevenueSeries(addInstructor("idle@example.com").id, "all").points
    ).toEqual([]);
  });
});
