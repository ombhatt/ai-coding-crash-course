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
  getAnalyticsCourses,
  getAudienceSummary,
  getCourseCompletion,
  getCourseDropOff,
  getCourseRatings,
  getQuizPassRates,
  getRevenueByCountry,
  getTopBuyers,
  getUnredeemedSeatCount,
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

describe("across all instructors (null filter)", () => {
  it("sums revenue across every instructor's courses", () => {
    const other = addInstructor("other@example.com");
    addPurchase(base.course.id, 5000);
    addPurchase(addCourse(other.id, "other-course").id, 3000);

    expect(getRevenueSummary(null, "all")).toEqual({
      gross: 8000,
      fee: 1600,
      net: 6400,
    });
  });

  it("charts every instructor's sales in the same buckets", () => {
    const other = addInstructor("other@example.com");
    addPurchase(base.course.id, 500, "2026-06-15T09:00:00.000Z");
    addPurchase(
      addCourse(other.id, "other-course").id,
      250,
      "2026-06-15T01:00:00.000Z"
    );

    expect(getRevenueSeries(null, "7d").points.at(-1)).toEqual({
      start: "2026-06-15",
      gross: 750,
    });
  });

  it("has published courses when any instructor does", () => {
    const idle = addInstructor("idle@example.com");
    expect(hasPublishedCourses(idle.id)).toBe(false);
    expect(hasPublishedCourses(null)).toBe(true);

    // Every course on the platform back to draft.
    testDb
      .update(schema.courses)
      .set({ status: schema.CourseStatus.Draft })
      .run();

    expect(hasPublishedCourses(null)).toBe(false);
  });

  it("counts each buyer and student once across every instructor", () => {
    const otherCourse = addCourse(
      addInstructor("other@example.com").id,
      "other-course"
    );
    const ann = addStudent("ann@example.com");
    const bob = addStudent("bob@example.com");
    // Ann buys from both instructors; Bob from the other one only.
    buyAndEnroll(ann.id, base.course.id, 5000);
    buyAndEnroll(ann.id, otherCourse.id, 3000);
    buyAndEnroll(bob.id, otherCourse.id, 1000);

    // 9000 across 2 distinct students.
    expect(getAudienceSummary(null, "all")).toEqual({
      buyers: 2,
      students: 2,
      revenuePerStudent: 4500,
    });
  });

  it("counts unredeemed seats on every instructor's courses", () => {
    const otherCourse = addCourse(
      addInstructor("other@example.com").id,
      "other-course"
    );
    const ria = addStudent("ria@example.com");
    buyTeamSeats(addStudent("tom@example.com").id, base.course.id, 9000, 3, [
      ria.id,
    ]);
    buyTeamSeats(addStudent("una@example.com").id, otherCourse.id, 4000, 2, []);

    // 2 left on Tom's team, 2 on Una's.
    expect(getUnredeemedSeatCount(null)).toBe(4);
  });

  it("ranks buyers by their spend across every instructor", () => {
    const otherCourse = addCourse(
      addInstructor("other@example.com").id,
      "other-course"
    );
    const ann = addStudent("ann@example.com");
    const bob = addStudent("bob@example.com");
    // Ann enrolled only with the other instructor; Bob only with base's.
    buyAndEnroll(ann.id, base.course.id, 4000);
    testDb
      .delete(schema.enrollments)
      .where(eq(schema.enrollments.userId, ann.id))
      .run();
    buyAndEnroll(ann.id, otherCourse.id, 3000);
    buyAndEnroll(bob.id, base.course.id, 6000);

    expect(getTopBuyers(null, "all")).toMatchObject([
      { userId: ann.id, totalSpent: 7000, enrolled: true },
      { userId: bob.id, totalSpent: 6000, enrolled: true },
    ]);
  });

  it("lists every instructor's published courses in the ratings", () => {
    const otherCourse = addCourse(
      addInstructor("other@example.com").id,
      "other-course"
    );

    expect(getCourseRatings(null)).toEqual([
      {
        courseId: base.course.id,
        title: "Test Course",
        average: null,
        count: 0,
      },
      {
        courseId: otherCourse.id,
        title: "other-course",
        average: null,
        count: 0,
      },
    ]);
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

// ─── Audience fixture ───
// A solo buyer who enrolled, and a team buyer who bought seats for others and
// never enrolled themselves; some of those seats are redeemed.

function addStudent(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

function enroll(userId: number, courseId: number, enrolledAt = daysAgo(1)) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId, enrolledAt })
    .run();
}

/** An individual purchase, which also enrolls the buyer. */
function buyAndEnroll(
  userId: number,
  courseId: number,
  amountPaid: number,
  at = daysAgo(1)
) {
  testDb
    .insert(schema.purchases)
    .values({ userId, courseId, amountPaid, createdAt: at })
    .run();
  enroll(userId, courseId, at);
}

/**
 * One purchase row paying for `seats` coupons. The buyer is not enrolled;
 * each redeemer gets a coupon and an enrollment, with no purchase of their own.
 */
function buyTeamSeats(
  buyerId: number,
  courseId: number,
  amountPaid: number,
  seats: number,
  redeemerIds: number[],
  at = daysAgo(1)
) {
  const purchase = testDb
    .insert(schema.purchases)
    .values({ userId: buyerId, courseId, amountPaid, createdAt: at })
    .returning()
    .get();
  const team = testDb.insert(schema.teams).values({}).returning().get();
  for (let seat = 0; seat < seats; seat++) {
    const redeemerId = redeemerIds[seat];
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId,
        purchaseId: purchase.id,
        code: `T${purchase.id}-${seat}`,
        redeemedByUserId: redeemerId ?? null,
        redeemedAt: redeemerId ? at : null,
      })
      .run();
    if (redeemerId) enroll(redeemerId, courseId, at);
  }
}

describe("getAudienceSummary", () => {
  function seedTeamScenario() {
    const ann = addStudent("ann@example.com");
    const tom = addStudent("tom@example.com");
    const ria = addStudent("ria@example.com");
    const raj = addStudent("raj@example.com");
    buyAndEnroll(ann.id, base.course.id, 5000);
    buyTeamSeats(tom.id, base.course.id, 16000, 4, [ria.id, raj.id]);
    return { ann, tom, ria, raj };
  }

  it("counts buyers and students separately when team seats exist", () => {
    seedTeamScenario();

    const audience = getAudienceSummary(base.instructor.id, "all");

    // Buyers: Ann and Tom. Students: Ann, Ria and Raj — Tom never enrolled.
    expect(audience.buyers).toBe(2);
    expect(audience.students).toBe(3);
  });

  it("credits seat redeemers with their share of the team purchase", () => {
    seedTeamScenario();

    // Ann paid 5000 herself; Ria and Raj each hold one of four $160 seats, so
    // 4000 each. (5000 + 4000 + 4000) / 3 students = 4333.33. Counting only
    // students' own purchases would give 5000 / 3 = 1667.
    expect(
      getAudienceSummary(base.instructor.id, "all").revenuePerStudent
    ).toBe(4333);
  });

  it("counts only buyers and students from inside the range", () => {
    seedTeamScenario(); // all a day ago
    const early = addStudent("early@example.com");
    buyAndEnroll(early.id, base.course.id, 9000, daysAgo(60));

    expect(getAudienceSummary(base.instructor.id, "30d")).toMatchObject({
      buyers: 2,
      students: 3,
    });
    expect(getAudienceSummary(base.instructor.id, "90d")).toMatchObject({
      buyers: 3,
      students: 4,
    });
  });

  it("returns zeroes, not NaN, for an instructor with no audience", () => {
    const idle = addInstructor("idle@example.com");

    expect(getAudienceSummary(idle.id, "all")).toEqual({
      buyers: 0,
      students: 0,
      revenuePerStudent: 0,
    });
    expect(getUnredeemedSeatCount(idle.id)).toBe(0);
  });
});

describe("getUnredeemedSeatCount", () => {
  it("counts seats bought but not yet redeemed", () => {
    const tom = addStudent("tom@example.com");
    const ria = addStudent("ria@example.com");
    const raj = addStudent("raj@example.com");
    buyTeamSeats(tom.id, base.course.id, 16000, 4, [ria.id, raj.id]);
    const other = addStudent("other@example.com");
    buyTeamSeats(other.id, base.course.id, 3000, 3, []);

    // Tom's team: 4 seats, 2 redeemed. The other team: 3 seats, none redeemed.
    expect(getUnredeemedSeatCount(base.instructor.id)).toBe(5);
  });

  it("ignores seats on other instructors' courses", () => {
    const other = addCourse(addInstructor("x@example.com").id, "theirs");
    buyTeamSeats(addStudent("buyer@example.com").id, other.id, 3000, 3, []);

    expect(getUnredeemedSeatCount(base.instructor.id)).toBe(0);
  });
});

describe("getTopBuyers", () => {
  it("ranks buyers by spend, including a team buyer who never enrolled", () => {
    const ann = addStudent("ann@example.com");
    const tom = addStudent("tom@example.com");
    const ria = addStudent("ria@example.com");
    buyAndEnroll(ann.id, base.course.id, 5000);
    buyTeamSeats(tom.id, base.course.id, 16000, 4, [ria.id]);

    expect(getTopBuyers(base.instructor.id, "all")).toEqual([
      {
        userId: tom.id,
        name: "tom@example.com",
        email: "tom@example.com",
        totalSpent: 16000,
        seats: 4,
        unredeemedSeats: 3,
        enrolled: false,
      },
      {
        userId: ann.id,
        name: "ann@example.com",
        email: "ann@example.com",
        totalSpent: 5000,
        seats: 0,
        unredeemedSeats: 0,
        enrolled: true,
      },
    ]);
  });

  it("sums a buyer's spend across the instructor's courses only", () => {
    const ann = addStudent("ann@example.com");
    const second = addCourse(base.instructor.id, "second-course");
    const elsewhere = addCourse(addInstructor("x@example.com").id, "elsewhere");
    buyAndEnroll(ann.id, base.course.id, 5000);
    buyAndEnroll(ann.id, second.id, 2500);
    buyAndEnroll(ann.id, elsewhere.id, 99999);

    expect(getTopBuyers(base.instructor.id, "all")).toMatchObject([
      { userId: ann.id, totalSpent: 7500 },
    ]);
  });

  it("caps the leaderboard at the 10 biggest spenders in the range", () => {
    for (let i = 1; i <= 12; i++) {
      const buyer = addStudent(`buyer${i}@example.com`);
      buyAndEnroll(buyer.id, base.course.id, i * 100);
    }
    const old = addStudent("old@example.com");
    buyAndEnroll(old.id, base.course.id, 1_000_000, daysAgo(60));

    const top = getTopBuyers(base.instructor.id, "30d");

    expect(top.map((b) => b.totalSpent)).toEqual([
      1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300,
    ]);
  });

  it("is empty for an instructor with no sales", () => {
    expect(getTopBuyers(base.instructor.id, "all")).toEqual([]);
  });
});

describe("getCourseRatings", () => {
  let raters: number;
  beforeEach(() => {
    raters = 0;
  });

  function rate(courseId: number, rating: number) {
    const rater = addStudent(`rater${++raters}@example.com`);
    testDb
      .insert(schema.courseRatings)
      .values({ userId: rater.id, courseId, rating })
      .run();
  }

  it("lists each published course's average and count, unrated ones included", () => {
    const second = addCourse(base.instructor.id, "second-course");
    rate(base.course.id, 5);
    rate(base.course.id, 4);
    rate(base.course.id, 4);
    rate(addCourse(addInstructor("x@example.com").id, "theirs").id, 1);

    expect(getCourseRatings(base.instructor.id)).toEqual([
      {
        courseId: base.course.id,
        title: "Test Course",
        average: 4.3,
        count: 3,
      },
      { courseId: second.id, title: "second-course", average: null, count: 0 },
    ]);
  });
});

describe("getAnalyticsCourses", () => {
  function setStatus(courseId: number, status: schema.CourseStatus) {
    testDb
      .update(schema.courses)
      .set({ status })
      .where(eq(schema.courses.id, courseId))
      .run();
  }

  it("lists all the instructor's own courses, published ones first, by title", () => {
    const draft = addCourse(base.instructor.id, "a-draft");
    setStatus(draft.id, schema.CourseStatus.Draft);
    const archived = addCourse(base.instructor.id, "b-archived");
    setStatus(archived.id, schema.CourseStatus.Archived);
    const zebra = addCourse(base.instructor.id, "zebra");
    const apple = addCourse(base.instructor.id, "apple");
    addCourse(addInstructor("x@example.com").id, "theirs");

    expect(getAnalyticsCourses(base.instructor.id)).toEqual([
      { id: apple.id, title: "apple", status: "published" },
      { id: base.course.id, title: "Test Course", status: "published" },
      { id: zebra.id, title: "zebra", status: "published" },
      { id: draft.id, title: "a-draft", status: "draft" },
      { id: archived.id, title: "b-archived", status: "archived" },
    ]);
  });
});

describe("getCourseCompletion", () => {
  /** A module holding `count` lessons on the course; returns the lesson ids. */
  function addLessons(courseId: number, count: number) {
    const module = testDb
      .insert(schema.modules)
      .values({ courseId, title: "Module", position: 1 })
      .returning()
      .get();
    return Array.from(
      { length: count },
      (_, i) =>
        testDb
          .insert(schema.lessons)
          .values({ moduleId: module.id, title: `Lesson ${i}`, position: i })
          .returning()
          .get().id
    );
  }

  function progress(
    userId: number,
    lessonIds: number[],
    status = schema.LessonProgressStatus.Completed
  ) {
    for (const lessonId of lessonIds) {
      testDb
        .insert(schema.lessonProgress)
        .values({ userId, lessonId, status })
        .run();
    }
  }

  it("averages lesson progress over every enrollee, separately from who finished", () => {
    const lessons = addLessons(base.course.id, 3);
    const finisher = addStudent("finisher@example.com");
    const partway = addStudent("partway@example.com");
    const idle = addStudent("idle@example.com");
    for (const student of [finisher, partway, idle]) {
      enroll(student.id, base.course.id);
    }
    progress(finisher.id, lessons);
    progress(partway.id, lessons.slice(0, 2));

    // (3/3 + 2/3 + 0/3) / 3 = 55.6% on average, but only one finished.
    expect(getCourseCompletion(base.instructor.id, base.course.id)).toEqual({
      enrollees: 3,
      averageProgress: 56,
      finished: 1,
    });
  });

  it("also counts an enrollment marked complete as finished", () => {
    const lessons = addLessons(base.course.id, 2);
    const marked = addStudent("marked@example.com");
    testDb
      .insert(schema.enrollments)
      .values({
        userId: marked.id,
        courseId: base.course.id,
        completedAt: daysAgo(1),
      })
      .run();
    progress(marked.id, lessons.slice(0, 1));

    expect(getCourseCompletion(base.instructor.id, base.course.id)).toEqual({
      enrollees: 1,
      averageProgress: 50,
      finished: 1,
    });
  });

  it("counts only completed lessons of this course, each once", () => {
    const lessons = addLessons(base.course.id, 4);
    const elsewhere = addLessons(
      addCourse(base.instructor.id, "other-course").id,
      4
    );
    const student = addStudent("student@example.com");
    enroll(student.id, base.course.id);
    progress(student.id, lessons.slice(0, 1));
    progress(student.id, lessons.slice(0, 1)); // a duplicate record
    progress(
      student.id,
      lessons.slice(1),
      schema.LessonProgressStatus.InProgress
    );
    progress(student.id, elsewhere);

    expect(getCourseCompletion(base.instructor.id, base.course.id)).toEqual({
      enrollees: 1,
      averageProgress: 25,
      finished: 0,
    });
  });

  it("doesn't call anyone finished on a course with no lessons yet", () => {
    enroll(addStudent("early@example.com").id, base.course.id);

    expect(getCourseCompletion(base.instructor.id, base.course.id)).toEqual({
      enrollees: 1,
      averageProgress: 0,
      finished: 0,
    });
  });

  it("is null for a course that isn't the instructor's", () => {
    const theirs = addCourse(addInstructor("x@example.com").id, "theirs");
    enroll(addStudent("student@example.com").id, theirs.id);

    expect(getCourseCompletion(base.instructor.id, theirs.id)).toBeNull();
  });

  it("is all zeroes, not NaN, for a course nobody has enrolled in", () => {
    addLessons(base.course.id, 3);

    expect(getCourseCompletion(base.instructor.id, base.course.id)).toEqual({
      enrollees: 0,
      averageProgress: 0,
      finished: 0,
    });
  });
});

describe("getCourseDropOff", () => {
  /** A module of lessons, in the order given; returns the lesson ids. */
  function addModule(
    courseId: number,
    position: number,
    lessonTitles: string[]
  ) {
    const module = testDb
      .insert(schema.modules)
      .values({ courseId, title: `Module ${position}`, position })
      .returning()
      .get();
    return lessonTitles.map(
      (title, i) =>
        testDb
          .insert(schema.lessons)
          .values({ moduleId: module.id, title, position: i + 1 })
          .returning()
          .get().id
    );
  }

  /** An enrolled student with a progress record on each of `lessonIds`. */
  function student(
    email: string,
    lessonIds: number[],
    status = schema.LessonProgressStatus.Completed
  ) {
    const user = addStudent(email);
    enroll(user.id, base.course.id);
    for (const lessonId of lessonIds) {
      testDb
        .insert(schema.lessonProgress)
        .values({ userId: user.id, lessonId, status })
        .run();
    }
    return user;
  }

  /** [title, reached, drop] per lesson, in course order. */
  function bars(instructorId: number | null = base.instructor.id) {
    return getCourseDropOff(instructorId, base.course.id)!.modules.flatMap(
      (m) => m.lessons.map((l) => [l.title, l.reached, l.drop])
    );
  }

  it("counts, per lesson, the enrollees who got at least that far", () => {
    const [intro, setup] = addModule(base.course.id, 1, ["Intro", "Setup"]);
    const [cliff, after] = addModule(base.course.id, 2, ["Cliff", "After"]);
    student("all@example.com", [intro, setup, cliff, after]);
    student("stuck1@example.com", [intro, setup, cliff]);
    student("stuck2@example.com", [intro, setup]);
    student("stuck3@example.com", [intro, setup, cliff]);
    student("early@example.com", [intro]);
    student("never@example.com", []);

    // 6 enrolled, 5 started. Three get as far as Cliff and only one goes on:
    // the drop beside each bar is who got that far and no further.
    expect(bars()).toEqual([
      ["Intro", 5, 1],
      ["Setup", 4, 1],
      ["Cliff", 3, 2],
      ["After", 1, 0],
    ]);
    expect(getCourseDropOff(base.instructor.id, base.course.id)).toMatchObject({
      enrollees: 6,
      neverStarted: 1,
    });
  });

  it("still counts a student at a lesson they skipped on the way past it", () => {
    const [first, skipped] = addModule(base.course.id, 1, ["First", "Skipped"]);
    const [later, last] = addModule(base.course.id, 2, ["Later", "Last"]);
    student("skipper@example.com", [first, later]);
    student("stayer@example.com", [first, skipped]);
    student("jumper@example.com", [last]);

    // Nobody dips back up: Skipped keeps everyone who went past it.
    const reached = bars().map(([, count]) => count as number);
    reached.forEach((count, i) =>
      expect(count).toBeLessThanOrEqual(reached[i - 1] ?? count)
    );
    expect(bars()).toEqual([
      ["First", 3, 0],
      ["Skipped", 3, 1],
      ["Later", 2, 1],
      ["Last", 1, 0],
    ]);
  });

  it("counts a lesson in progress as reached", () => {
    const [one, two, three] = addModule(base.course.id, 1, ["1", "2", "3"]);
    student("done@example.com", [one]);
    student(
      "midway@example.com",
      [two],
      schema.LessonProgressStatus.InProgress
    );
    student(
      "ahead@example.com",
      [three],
      schema.LessonProgressStatus.InProgress
    );

    expect(bars()).toEqual([
      ["1", 3, 1],
      ["2", 2, 1],
      ["3", 1, 0],
    ]);
  });

  it("ignores progress from students not enrolled, and on other courses", () => {
    const [one, two] = addModule(base.course.id, 1, ["1", "2"]);
    const enrolled = student("enrolled@example.com", [one]);
    const visitor = addStudent("visitor@example.com");
    const other = addCourse(base.instructor.id, "other");
    const [elsewhere] = addModule(other.id, 1, ["Elsewhere"]);
    for (const [userId, lessonId] of [
      [visitor.id, two],
      [enrolled.id, elsewhere],
    ]) {
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId,
          lessonId,
          status: schema.LessonProgressStatus.Completed,
        })
        .run();
    }

    expect(bars()).toEqual([
      ["1", 1, 1],
      ["2", 0, 0],
    ]);
  });

  it("subtotals each module: who reached it, and who stopped inside it", () => {
    const [a1, a2] = addModule(base.course.id, 1, ["A1", "A2"]);
    const [b1, b2] = addModule(base.course.id, 2, ["B1", "B2"]);
    student("a1@example.com", [a1]);
    student("a2@example.com", [a1, a2]);
    student("b1@example.com", [a1, a2, b1]);
    student("b2@example.com", [a1, a2, b1, b2]);
    student("idle@example.com", []);

    const modules = getCourseDropOff(
      base.instructor.id,
      base.course.id
    )!.modules;
    // Module 1: 4 of 5 start it; a1 and a2 stop there. Module 2: 2 reach it
    // and b1 stops; b2 reached the end. idle never started at all.
    expect(
      modules.map(({ title, reached, drop }) => [title, reached, drop])
    ).toEqual([
      ["Module 1", 4, 2],
      ["Module 2", 2, 1],
    ]);
  });

  it("is null for a course that isn't the instructor's", () => {
    const theirs = addCourse(addInstructor("x@example.com").id, "theirs");

    expect(getCourseDropOff(base.instructor.id, theirs.id)).toBeNull();
  });

  it("shows any instructor's course to the all-instructors view", () => {
    const theirs = addCourse(addInstructor("x@example.com").id, "theirs");
    enroll(addStudent("student@example.com").id, theirs.id);

    expect(getCourseDropOff(null, theirs.id)).toEqual({
      enrollees: 1,
      neverStarted: 1,
      modules: [],
    });
  });

  it("is all zeroes, not NaN, for a course nobody has enrolled in", () => {
    addModule(base.course.id, 1, ["Only"]);
    addModule(base.course.id, 2, []); // a module with no lessons yet

    expect(getCourseDropOff(base.instructor.id, base.course.id)).toEqual({
      enrollees: 0,
      neverStarted: 0,
      modules: [
        {
          id: expect.any(Number),
          title: "Module 1",
          reached: 0,
          drop: 0,
          lessons: [
            { id: expect.any(Number), title: "Only", reached: 0, drop: 0 },
          ],
        },
      ],
    });
  });
});

describe("course detail for all instructors (admins)", () => {
  it("offers every instructor's courses when no instructor is picked", () => {
    const theirs = addCourse(addInstructor("x@example.com").id, "theirs");

    expect(getAnalyticsCourses(null).map((c) => c.id)).toEqual(
      expect.arrayContaining([base.course.id, theirs.id])
    );
    expect(getAnalyticsCourses(null)).toHaveLength(2);
  });

  it("reports completion for any instructor's course", () => {
    const theirs = addCourse(addInstructor("x@example.com").id, "theirs");
    enroll(addStudent("student@example.com").id, theirs.id);

    expect(getCourseCompletion(null, theirs.id)).toEqual({
      enrollees: 1,
      averageProgress: 0,
      finished: 0,
    });
  });
});

describe("getQuizPassRates", () => {
  /** A quiz on its own lesson, in a new module of the course. */
  function addQuiz(courseId: number, title: string, position = 1) {
    const module = testDb
      .insert(schema.modules)
      .values({ courseId, title: `Module ${position}`, position })
      .returning()
      .get();
    const lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: module.id, title: `${title} lesson`, position: 1 })
      .returning()
      .get();
    return testDb
      .insert(schema.quizzes)
      .values({ lessonId: lesson.id, title, passingScore: 0.7 })
      .returning()
      .get();
  }

  function attempt(
    userId: number,
    quizId: number,
    passed: boolean,
    attemptedAt = daysAgo(1)
  ) {
    testDb
      .insert(schema.quizAttempts)
      .values({ userId, quizId, score: passed ? 1 : 0, passed, attemptedAt })
      .run();
  }

  it("rates a quiz by who passed first time, and who passed in the end", () => {
    const quiz = addQuiz(base.course.id, "Generics quiz");
    const natural = addStudent("natural@example.com");
    const retaker = addStudent("retaker@example.com");
    const stuck = addStudent("stuck@example.com");
    attempt(natural.id, quiz.id, true, daysAgo(5));
    attempt(retaker.id, quiz.id, false, daysAgo(5));
    attempt(retaker.id, quiz.id, true, daysAgo(4));
    attempt(stuck.id, quiz.id, false, daysAgo(5));
    attempt(stuck.id, quiz.id, false, daysAgo(4));

    // 1 of 3 passed on their first attempt; 2 of 3 have passed by now.
    expect(getQuizPassRates(base.instructor.id, base.course.id)).toEqual([
      {
        quizId: quiz.id,
        title: "Generics quiz",
        lessonTitle: "Generics quiz lesson",
        students: 3,
        firstAttemptPassRate: 33,
        passRate: 67,
      },
    ]);
  });

  it("takes the earliest attempt as the first, whatever order it was recorded in", () => {
    const quiz = addQuiz(base.course.id, "Generics quiz");
    const student = addStudent("student@example.com");
    attempt(student.id, quiz.id, true, daysAgo(2));
    attempt(student.id, quiz.id, false, daysAgo(3));

    expect(getQuizPassRates(base.instructor.id, base.course.id)).toMatchObject([
      { students: 1, firstAttemptPassRate: 0, passRate: 100 },
    ]);
  });

  it("lists every quiz of this course in course order, unattempted ones at zero", () => {
    const later = addQuiz(base.course.id, "Later quiz", 2);
    const earlier = addQuiz(base.course.id, "Earlier quiz", 1);
    const elsewhere = addQuiz(
      addCourse(base.instructor.id, "other-course").id,
      "Elsewhere quiz"
    );
    const student = addStudent("student@example.com");
    attempt(student.id, later.id, true);
    attempt(student.id, elsewhere.id, false);

    expect(getQuizPassRates(base.instructor.id, base.course.id)).toMatchObject([
      {
        quizId: earlier.id,
        students: 0,
        firstAttemptPassRate: 0,
        passRate: 0,
      },
      {
        quizId: later.id,
        students: 1,
        firstAttemptPassRate: 100,
        passRate: 100,
      },
    ]);
  });

  it("is empty for a course with no quizzes", () => {
    expect(getQuizPassRates(base.instructor.id, base.course.id)).toEqual([]);
  });

  it("is null for a course that isn't the instructor's, unless viewing everyone", () => {
    const theirs = addCourse(addInstructor("x@example.com").id, "theirs");
    addQuiz(theirs.id, "Their quiz");

    expect(getQuizPassRates(base.instructor.id, theirs.id)).toBeNull();
    expect(getQuizPassRates(null, theirs.id)).toHaveLength(1);
  });
});

describe("getRevenueByCountry", () => {
  function buyFrom(
    courseId: number,
    country: string | null,
    amountPaid: number,
    createdAt = daysAgo(1)
  ) {
    testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId,
        amountPaid,
        country,
        createdAt,
      })
      .run();
  }

  it("splits the course's gross by country, PPP-discounted and full price adding up to it", () => {
    buyFrom(base.course.id, "US", 5000);
    buyFrom(base.course.id, "US", 5000);
    buyFrom(base.course.id, "IN", 2500); // 50% off
    buyFrom(base.course.id, "BR", 10500); // a team of three at 30% off
    buyFrom(base.course.id, null, 5000);

    const revenue = getRevenueByCountry(
      base.instructor.id,
      base.course.id,
      "all"
    )!;

    expect(revenue).toEqual({
      gross: 28000,
      pppDiscountedGross: 13000,
      fullPriceGross: 15000,
      countries: [
        {
          country: "BR",
          name: "Brazil",
          purchases: 1,
          gross: 10500,
          pppDiscountPercent: 30,
        },
        {
          country: "US",
          name: "United States",
          purchases: 2,
          gross: 10000,
          pppDiscountPercent: 0,
        },
        {
          country: null,
          name: "Unknown",
          purchases: 1,
          gross: 5000,
          pppDiscountPercent: 0,
        },
        {
          country: "IN",
          name: "India",
          purchases: 1,
          gross: 2500,
          pppDiscountPercent: 50,
        },
      ],
    });
    const countriesTotal = revenue.countries.reduce((s, c) => s + c.gross, 0);
    expect(countriesTotal).toBe(revenue.gross);
    expect(revenue.pppDiscountedGross + revenue.fullPriceGross).toBe(
      revenue.gross
    );
  });

  it("counts nothing as discounted on a course with PPP pricing off", () => {
    testDb
      .update(schema.courses)
      .set({ pppEnabled: false })
      .where(eq(schema.courses.id, base.course.id))
      .run();
    buyFrom(base.course.id, "IN", 5000);

    expect(
      getRevenueByCountry(base.instructor.id, base.course.id, "all")
    ).toMatchObject({
      gross: 5000,
      pppDiscountedGross: 0,
      fullPriceGross: 5000,
      countries: [{ country: "IN", pppDiscountPercent: 0 }],
    });
  });

  it.each([
    ["7d", 1],
    ["30d", 1 + 20],
    ["all", 1 + 20 + 300],
  ] as const)(
    "counts only this course's purchases inside %s",
    (range, expected) => {
      buyFrom(base.course.id, "US", 1, daysAgo(3));
      buyFrom(base.course.id, "IN", 20, daysAgo(20));
      buyFrom(base.course.id, "US", 300, daysAgo(200));
      buyFrom(addCourse(base.instructor.id, "other").id, "US", 4000);

      const revenue = getRevenueByCountry(
        base.instructor.id,
        base.course.id,
        range
      )!;
      expect(revenue.gross).toBe(expected);
      expect(revenue.pppDiscountedGross + revenue.fullPriceGross).toBe(
        expected
      );
    }
  );

  it("is all zeroes, not NaN, for a course with no sales", () => {
    expect(
      getRevenueByCountry(base.instructor.id, base.course.id, "all")
    ).toEqual({
      gross: 0,
      pppDiscountedGross: 0,
      fullPriceGross: 0,
      countries: [],
    });
  });

  it("is null for a course that isn't the instructor's, unless viewing everyone", () => {
    const theirs = addCourse(addInstructor("x@example.com").id, "theirs");
    buyFrom(theirs.id, "US", 5000);

    expect(
      getRevenueByCountry(base.instructor.id, theirs.id, "all")
    ).toBeNull();
    expect(getRevenueByCountry(null, theirs.id, "all")?.gross).toBe(5000);
  });
});
