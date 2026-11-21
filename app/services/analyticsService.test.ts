import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getRevenueSummary, hasPublishedCourses } from "./analyticsService";

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

function addPurchase(courseId: number, amountPaid: number, createdAt = daysAgo(1)) {
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
      expect(getRevenueSummary(idle.id, range)).toEqual({ gross: 0, fee: 0, net: 0 });
    }
  });
});

describe("hasPublishedCourses", () => {
  it("is false for an instructor with no courses", () => {
    expect(hasPublishedCourses(addInstructor("idle@example.com").id)).toBe(false);
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
