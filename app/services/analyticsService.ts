import {
  type AnyColumn,
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import {
  CourseStatus,
  coupons,
  courses,
  enrollments,
  LessonProgressStatus,
  lessonProgress,
  lessons,
  modules,
  purchases,
  quizAttempts,
  quizzes,
  users,
} from "~/db/schema";
import { PLATFORM_FEE_PERCENT } from "~/lib/fees";
import { COUNTRIES, getDiscountForCountry } from "~/lib/ppp";
import { type AnalyticsRange, TOP_BUYER_LIMIT } from "~/lib/analytics";
import {
  type CourseRatingSummary,
  getCourseRatingSummaries,
} from "~/services/courseRatingService";

// ─── Instructor Analytics ───
// Aggregates behind the analytics page. Every figure is grouped SQL over the
// instructor's courses — never a loop over per-student helpers — so the page
// doesn't degrade as an audience grows.
//
// Every function takes an instructorId, or null for every instructor's courses
// at once — the platform-wide view admins get.

const RANGE_DAYS: Record<AnalyticsRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

/**
 * The earliest timestamp inside the range, or null for all time. Resolved here
 * rather than by the route so the boundary arithmetic sits behind the tests.
 */
function rangeCutoff(range: AnalyticsRange): string | null {
  const days = RANGE_DAYS[range];
  if (days === null) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** All in integer cents. `fee + net === gross` always. */
export type RevenueSummary = {
  gross: number;
  fee: number;
  net: number;
};

export function getRevenueSummary(
  instructorId: number | null,
  range: AnalyticsRange
): RevenueSummary {
  const row = db
    .select({ gross: sql<number>`coalesce(sum(${purchases.amountPaid}), 0)` })
    .from(purchases)
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(instructorPurchasesInRange(instructorId, rangeCutoff(range)))
    .get();

  const gross = row?.gross ?? 0;
  // Rounded once on the total, so the fee can't drift from the summed
  // per-purchase roundings; net takes the remainder so the three always add up.
  const fee = Math.round((gross * PLATFORM_FEE_PERCENT) / 100);
  return { gross, fee, net: gross - fee };
}

/** Purchases of the instructor's courses at or after the cutoff (inclusive). */
function instructorPurchasesInRange(
  instructorId: number | null,
  cutoff: string | null
) {
  return and(
    ownedBy(instructorId),
    cutoff ? gte(purchases.createdAt, cutoff) : undefined
  );
}

/** Courses taught by the instructor; no condition at all for null (everyone). */
function ownedBy(instructorId: number | null) {
  return instructorId === null
    ? undefined
    : eq(courses.instructorId, instructorId);
}

/**
 * The course, if the instructor may see it — any course for null (admins
 * viewing every instructor).
 */
function findOwnedCourse(instructorId: number | null, courseId: number) {
  return db
    .select({ pppEnabled: courses.pppEnabled })
    .from(courses)
    .where(and(eq(courses.id, courseId), ownedBy(instructorId)))
    .get();
}

// ─── Revenue over time ───
// Bars are calendar buckets in UTC, sized so each range draws a readable
// number of them. The first and last buckets can be partial — the series
// covers exactly the same purchases as getRevenueSummary, so the bars always
// sum to the gross figure shown beside them.

export type RevenueGranularity = "day" | "week" | "month";

const RANGE_GRANULARITY: Record<AnalyticsRange, RevenueGranularity> = {
  "7d": "day",
  "30d": "day",
  "90d": "week",
  all: "month",
};

export type RevenueSeries = {
  granularity: RevenueGranularity;
  /** `start` is the bucket's first day, `YYYY-MM-DD`. Empty when nothing sold. */
  points: { start: string; gross: number }[];
};

export function getRevenueSeries(
  instructorId: number | null,
  range: AnalyticsRange
): RevenueSeries {
  const granularity = RANGE_GRANULARITY[range];
  const cutoff = rangeCutoff(range);

  const day = sql<string>`substr(${purchases.createdAt}, 1, 10)`;
  const days = db
    .select({ day, gross: sql<number>`sum(${purchases.amountPaid})` })
    .from(purchases)
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(instructorPurchasesInRange(instructorId, cutoff))
    .groupBy(day)
    .orderBy(day)
    .all();

  if (days.length === 0) return { granularity, points: [] };

  const totals = new Map<string, number>();
  for (const { day, gross } of days) {
    const key = bucketStart(day, granularity);
    totals.set(key, (totals.get(key) ?? 0) + gross);
  }

  // Zero-fill every bucket from the window's start (or the first sale, for
  // all time) through today, so quiet periods show as gaps, not as nothing.
  const first = bucketStart((cutoff ?? days[0].day).slice(0, 10), granularity);
  const last = bucketStart(new Date().toISOString().slice(0, 10), granularity);
  const points = [];
  for (let key = first; key <= last; key = nextBucket(key, granularity)) {
    points.push({ start: key, gross: totals.get(key) ?? 0 });
  }
  return { granularity, points };
}

/** The first day of the bucket holding `day` (both `YYYY-MM-DD`, UTC). */
function bucketStart(day: string, granularity: RevenueGranularity): string {
  if (granularity === "day") return day;
  if (granularity === "month") return `${day.slice(0, 7)}-01`;
  // Weeks start on Monday.
  const date = new Date(`${day}T00:00:00.000Z`);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - sinceMonday);
  return date.toISOString().slice(0, 10);
}

function nextBucket(start: string, granularity: RevenueGranularity): string {
  const date = new Date(`${start}T00:00:00.000Z`);
  if (granularity === "day") date.setUTCDate(date.getUTCDate() + 1);
  if (granularity === "week") date.setUTCDate(date.getUTCDate() + 7);
  if (granularity === "month") date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Whether the instructor has anything live. The page shows "publish your first
 * course" instead of a wall of zeroes when this is false.
 */
export function hasPublishedCourses(instructorId: number | null): boolean {
  const row = db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(ownedBy(instructorId), eq(courses.status, CourseStatus.Published))
    )
    .limit(1)
    .get();
  return row !== undefined;
}

// ─── Audience ───
// Buyers and students are different people. A team purchase is one purchase
// row covering several seats, its buyer often never enrolls, and the people
// who redeem those seats enroll with no purchase of their own.

export type AudienceSummary = {
  /** Distinct people who bought in the range. */
  buyers: number;
  /** Distinct people who enrolled in the range. */
  students: number;
  /**
   * Revenue those students brought in, per student, in cents. A seat redeemer
   * is credited with their share of the team purchase they came in on.
   */
  revenuePerStudent: number;
};

export function getAudienceSummary(
  instructorId: number | null,
  range: AnalyticsRange
): AudienceSummary {
  const cutoff = rangeCutoff(range);

  const buyers = db
    .select({ count: sql<number>`count(distinct ${purchases.userId})` })
    .from(purchases)
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(instructorPurchasesInRange(instructorId, cutoff))
    .get();

  const students = db
    .select({
      count: sql<number>`count(distinct ${enrollments.userId})`,
      revenue: sql<number>`coalesce(sum(${revenueFromEnrollment()}), 0)`,
    })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(
      and(
        ownedBy(instructorId),
        cutoff ? gte(enrollments.enrolledAt, cutoff) : undefined
      )
    )
    .get();

  const studentCount = students?.count ?? 0;
  return {
    buyers: buyers?.count ?? 0,
    students: studentCount,
    revenuePerStudent:
      studentCount === 0
        ? 0
        : Math.round((students?.revenue ?? 0) / studentCount),
  };
}

/**
 * What one enrollment (the outer query's row) brought in, in cents: the
 * student's own purchase of the course, or else an equal share of the team
 * purchase whose seat they redeemed. A team purchase is never its buyer's own
 * seat — they bought it for other people.
 */
function revenueFromEnrollment() {
  const own = alias(purchases, "own_purchase");
  const team = alias(purchases, "team_purchase");
  const seat = alias(coupons, "redeemed_seat");
  return sql<number>`coalesce(
    (select sum(${own.amountPaid}) from ${purchases} ${own}
      where ${own.userId} = ${enrollments.userId}
        and ${own.courseId} = ${enrollments.courseId}
        and ${seatsOn(own.id)} = 0),
    (select sum(${team.amountPaid} * 1.0 / ${seatsOn(team.id)}) from ${coupons} ${seat}
      join ${purchases} ${team} on ${team.id} = ${seat.purchaseId}
      where ${seat.redeemedByUserId} = ${enrollments.userId}
        and ${seat.courseId} = ${enrollments.courseId}),
    0
  )`;
}

/**
 * Team seats (coupons) a purchase paid for — 0 means an individual purchase.
 * Optionally only the ones nobody has redeemed.
 */
function seatsOn(purchaseId: AnyColumn, { unredeemed = false } = {}) {
  const seat = alias(coupons, "seat");
  return sql<number>`(select count(*) from ${coupons} ${seat}
    where ${seat.purchaseId} = ${purchaseId}
    ${unredeemed ? sql`and ${seat.redeemedByUserId} is null` : sql``})`;
}

/**
 * Seats bought on the instructor's courses that nobody has redeemed yet. A
 * current count with no meaningful date, so it ignores the range — the page
 * labels it "all time".
 */
export function getUnredeemedSeatCount(instructorId: number | null): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(coupons)
    .innerJoin(courses, eq(courses.id, coupons.courseId))
    .where(and(ownedBy(instructorId), isNull(coupons.redeemedByUserId)))
    .get();
  return row?.count ?? 0;
}

// ─── Top buyers ───

export type TopBuyer = {
  userId: number;
  name: string;
  email: string;
  /** Cents spent on the instructor's courses in the range. */
  totalSpent: number;
  /** Team seats bought in those purchases; 0 for individual buyers. */
  seats: number;
  /** Of those seats, how many nobody has redeemed yet. */
  unredeemedSeats: number;
  /**
   * Whether they're enrolled in any of the instructor's courses themselves (any
   * course at all, for the all-instructors view).
   */
  enrolled: boolean;
};

/**
 * The biggest spenders on the instructor's courses, most first. Ranked by
 * purchases, not enrollments, so a team buyer who never enrolled — often the
 * largest customer — still appears.
 */
export function getTopBuyers(
  instructorId: number | null,
  range: AnalyticsRange
): TopBuyer[] {
  const totalSpent = sql<number>`sum(${purchases.amountPaid})`;
  const ownEnrollment = alias(enrollments, "own_enrollment");
  const enrolledCourse = alias(courses, "enrolled_course");

  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      totalSpent,
      seats: sql<number>`sum(${seatsOn(purchases.id)})`,
      unredeemedSeats: sql<number>`sum(${seatsOn(purchases.id, { unredeemed: true })})`,
      enrolled:
        sql<boolean>`exists (select 1 from ${enrollments} ${ownEnrollment}
        join ${courses} ${enrolledCourse} on ${enrolledCourse.id} = ${ownEnrollment.courseId}
        where ${ownEnrollment.userId} = ${users.id}
          ${instructorId === null ? sql`` : sql`and ${enrolledCourse.instructorId} = ${instructorId}`})`.mapWith(
          Boolean
        ),
    })
    .from(purchases)
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .innerJoin(users, eq(users.id, purchases.userId))
    .where(instructorPurchasesInRange(instructorId, rangeCutoff(range)))
    .groupBy(users.id)
    .orderBy(desc(totalSpent), users.name)
    .limit(TOP_BUYER_LIMIT)
    .all();
}

// ─── Ratings ───
// Current state rather than activity, so no range: the page labels it
// "all time" instead of pretending to filter it.

export type CourseRating = CourseRatingSummary & {
  courseId: number;
  title: string;
};

/** Rating summary for each of the instructor's published courses. */
export function getCourseRatings(instructorId: number | null): CourseRating[] {
  const published = db
    .select({ courseId: courses.id, title: courses.title })
    .from(courses)
    .where(
      and(ownedBy(instructorId), eq(courses.status, CourseStatus.Published))
    )
    .orderBy(courses.id)
    .all();

  const summaries = getCourseRatingSummaries(published.map((c) => c.courseId));
  return published.map((course) => ({
    ...course,
    ...summaries.get(course.courseId)!,
  }));
}

// ─── Course completion ───
// Progress records carry no start time, so these are all-time figures. Two
// numbers rather than one "completion rate": average progress says whether
// people work through the course, the finished count says how many got to
// the end.

export type AnalyticsCourse = {
  id: number;
  title: string;
  status: CourseStatus;
};

/**
 * The courses the Course detail picker offers: every one the instructor owns
 * (every course on the platform for null),
 * drafts and archived included — enrollments survive unpublishing, so hiding
 * those courses would hide real students. Published come first, so defaulting
 * to the first lands on a live course.
 */
export function getAnalyticsCourses(
  instructorId: number | null
): AnalyticsCourse[] {
  return db
    .select({ id: courses.id, title: courses.title, status: courses.status })
    .from(courses)
    .where(ownedBy(instructorId))
    .orderBy(
      sql`${courses.status} <> ${CourseStatus.Published}`,
      sql`lower(${courses.title})`,
      courses.id
    )
    .all();
}

export type CourseCompletion = {
  /** Everyone enrolled in the course. */
  enrollees: number;
  /**
   * Mean of each enrollee's completed lessons / total lessons, as a whole
   * percentage. Lesson-count based, never duration-weighted. Enrollees who
   * never started count as 0.
   */
  averageProgress: number;
  /**
   * Enrollees who completed every lesson, or whose enrollment is marked
   * complete. Lessons are the main signal: enrollment completion is rarely
   * marked, so on its own it would undercount.
   */
  finished: number;
};

/**
 * Null when the course isn't the instructor's, so nothing leaks across. A null
 * instructor (admins viewing every instructor) may see any course.
 */
export function getCourseCompletion(
  instructorId: number | null,
  courseId: number
): CourseCompletion | null {
  if (!findOwnedCourse(instructorId, courseId)) return null;

  const progressLesson = alias(lessons, "progress_lesson");
  const progressModule = alias(modules, "progress_module");
  const completedLessons = sql<number>`(select count(distinct ${lessonProgress.lessonId})
    from ${lessonProgress}
    join ${lessons} ${progressLesson} on ${progressLesson.id} = ${lessonProgress.lessonId}
    join ${modules} ${progressModule} on ${progressModule.id} = ${progressLesson.moduleId}
    where ${progressModule.courseId} = ${enrollments.courseId}
      and ${lessonProgress.userId} = ${enrollments.userId}
      and ${lessonProgress.status} = ${LessonProgressStatus.Completed})`;

  const totalLessons =
    db
      .select({ count: sql<number>`count(*)` })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(eq(modules.courseId, courseId))
      .get()?.count ?? 0;

  const row = db
    .select({
      enrollees: sql<number>`count(*)`,
      completedLessons: sql<number>`coalesce(sum(${completedLessons}), 0)`,
      finished: sql<number>`coalesce(sum(
        ${enrollments.completedAt} is not null
          or (${totalLessons} > 0 and ${completedLessons} = ${totalLessons})
      ), 0)`,
    })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .get();

  const enrollees = row?.enrollees ?? 0;
  const possible = enrollees * totalLessons;
  return {
    enrollees,
    averageProgress:
      possible === 0
        ? 0
        : Math.round((100 * (row?.completedLessons ?? 0)) / possible),
    finished: row?.finished ?? 0,
  };
}

// ─── Drop-off ───
// Where students give up, from lesson progress records (not video events), so
// all time like completion. A lesson's bar counts the enrollees who reached at
// least that lesson — any progress on it or on a later one, in-progress
// included. The series can only descend, so a skipped lesson never looks like
// a lost student and a gap between neighbours is where people quit.

export type DropOffLesson = {
  id: number;
  title: string;
  /** Enrollees with progress on this lesson or any later one. */
  reached: number;
  /**
   * Reached this lesson but none after it: where they stopped. Always 0 on
   * the course's last lesson, since reaching it is getting to the end.
   */
  drop: number;
};

export type DropOffModule = {
  id: number;
  title: string;
  /** Enrollees who reached the module's first lesson. */
  reached: number;
  /** Students who stopped inside the module: its lessons' drops summed. */
  drop: number;
  lessons: DropOffLesson[];
};

export type CourseDropOff = {
  /** Everyone enrolled — the funnel's starting width. */
  enrollees: number;
  /** Enrollees with no progress on any lesson, so no lesson to pin them to. */
  neverStarted: number;
  /** In course order; modules without lessons are left out. */
  modules: DropOffModule[];
};

/** Course order: module position, then lesson position; ids break ties. */
const LESSON_ORDER = [
  modules.position,
  modules.id,
  lessons.position,
  lessons.id,
];

/**
 * Null when the course isn't the instructor's, like getCourseCompletion. Only
 * progress from students enrolled in the course counts.
 */
export function getCourseDropOff(
  instructorId: number | null,
  courseId: number
): CourseDropOff | null {
  if (!findOwnedCourse(instructorId, courseId)) return null;

  const courseLessons = db
    .select({
      id: lessons.id,
      title: lessons.title,
      moduleId: modules.id,
      moduleTitle: modules.title,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(eq(modules.courseId, courseId))
    .orderBy(...LESSON_ORDER)
    .all();

  const enrolled = db
    .select({ userId: enrollments.userId })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId));
  const enrollees =
    db
      .select({ count: sql<number>`count(distinct ${enrollments.userId})` })
      .from(enrollments)
      .where(eq(enrollments.courseId, courseId))
      .get()?.count ?? 0;

  // Each enrollee's furthest lesson as a 1-based position in course order,
  // then how many students stopped at each position.
  const ordered = db.$with("ordered").as(
    db
      .select({
        lessonId: lessons.id,
        ordinal: sql<number>`row_number() over (order by ${sql.join(
          LESSON_ORDER,
          sql`, `
        )})`.as("ordinal"),
      })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(eq(modules.courseId, courseId))
  );
  const furthest = db.$with("furthest").as(
    db
      .select({
        ordinal: sql<number>`max(${ordered.ordinal})`.as("furthest_ordinal"),
      })
      .from(lessonProgress)
      .innerJoin(ordered, eq(ordered.lessonId, lessonProgress.lessonId))
      .where(inArray(lessonProgress.userId, enrolled))
      .groupBy(lessonProgress.userId)
  );
  const stoppedAt = new Map(
    db
      .with(ordered, furthest)
      .select({ ordinal: furthest.ordinal, students: sql<number>`count(*)` })
      .from(furthest)
      .groupBy(sql`${furthest.ordinal}`)
      .all()
      .map((row) => [row.ordinal, row.students])
  );

  // Reached lesson k = stopped at k or later: a running sum from the end.
  const reached: number[] = [];
  for (let i = courseLessons.length - 1, sum = 0; i >= 0; i--) {
    sum += stoppedAt.get(i + 1) ?? 0;
    reached[i] = sum;
  }

  const byModule = new Map<number, DropOffModule>();
  const last = courseLessons.length - 1;
  courseLessons.forEach((lesson, i) => {
    // Stopping at the last lesson is getting to the end, not dropping off.
    const drop = i === last ? 0 : (stoppedAt.get(i + 1) ?? 0);
    let module = byModule.get(lesson.moduleId);
    if (!module) {
      module = {
        id: lesson.moduleId,
        title: lesson.moduleTitle,
        reached: reached[i],
        drop: 0,
        lessons: [],
      };
      byModule.set(lesson.moduleId, module);
    }
    module.drop += drop;
    module.lessons.push({
      id: lesson.id,
      title: lesson.title,
      reached: reached[i],
      drop,
    });
  });

  return {
    enrollees,
    neverStarted: enrollees - (reached[0] ?? 0),
    modules: [...byModule.values()],
  };
}

// ─── Quiz pass rates ───
// Whether an assessment is too hard or too easy shows in how people do on
// their first go: a retake comes after a second look at the lesson, and counting
// attempts would let one student's five retries drown out everyone else. So
// each quiz is rated per student — first-attempt pass rate for difficulty,
// beside the share who have passed at all, which says whether it holds people
// back. All time: attempts are few, and a quiz's difficulty doesn't drift.

export type QuizPassRate = {
  quizId: number;
  title: string;
  lessonTitle: string;
  /** Distinct students who have attempted the quiz. */
  students: number;
  /** Whole percentage of those students who passed their first attempt. */
  firstAttemptPassRate: number;
  /** Whole percentage of those students who have passed, retakes included. */
  passRate: number;
};

/**
 * Every quiz in the course, in course order. Null when the course isn't the
 * instructor's.
 */
export function getQuizPassRates(
  instructorId: number | null,
  courseId: number
): QuizPassRate[] | null {
  if (!findOwnedCourse(instructorId, courseId)) return null;

  const earlier = alias(quizAttempts, "earlier_attempt");
  const isFirstAttempt = sql`not exists (select 1 from ${quizAttempts} ${earlier}
    where ${earlier.userId} = ${quizAttempts.userId}
      and ${earlier.quizId} = ${quizAttempts.quizId}
      and (${earlier.attemptedAt} < ${quizAttempts.attemptedAt}
        or (${earlier.attemptedAt} = ${quizAttempts.attemptedAt}
          and ${earlier.id} < ${quizAttempts.id})))`;

  const rows = db
    .select({
      quizId: quizzes.id,
      title: quizzes.title,
      lessonTitle: lessons.title,
      students: sql<number>`count(distinct ${quizAttempts.userId})`,
      passedFirstTime: sql<number>`count(distinct case
        when ${quizAttempts.passed} and ${isFirstAttempt}
        then ${quizAttempts.userId} end)`,
      passed: sql<number>`count(distinct case
        when ${quizAttempts.passed} then ${quizAttempts.userId} end)`,
    })
    .from(quizzes)
    .innerJoin(lessons, eq(lessons.id, quizzes.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .leftJoin(quizAttempts, eq(quizAttempts.quizId, quizzes.id))
    .where(eq(modules.courseId, courseId))
    .groupBy(quizzes.id)
    .orderBy(modules.position, lessons.position, quizzes.id)
    .all();

  return rows.map(({ passedFirstTime, passed, ...quiz }) => ({
    ...quiz,
    firstAttemptPassRate: percentOf(passedFirstTime, quiz.students),
    passRate: percentOf(passed, quiz.students),
  }));
}

// ─── Revenue by country ───
// Purchases record the buyer's country, not the discount they got, so each
// country is classified by the PPP discount its buyers are charged — none at
// all on a course with PPP pricing switched off. Every
// purchase lands in exactly one country bucket — a missing country is its own
// "Unknown" bucket — so the buckets, and the discounted / full-price split,
// always add up to the course's gross for the range.

export type CountryRevenue = {
  /** ISO code; null for purchases that recorded no country. */
  country: string | null;
  name: string;
  purchases: number;
  /** Cents. */
  gross: number;
  /** The PPP discount buyers from here pay at, as a whole percentage; 0 for full price. */
  pppDiscountPercent: number;
};

/** All in integer cents. `pppDiscountedGross + fullPriceGross === gross`. */
export type CountryRevenueSummary = {
  gross: number;
  pppDiscountedGross: number;
  fullPriceGross: number;
  /** Most revenue first. */
  countries: CountryRevenue[];
};

/** Null when the course isn't the instructor's. */
export function getRevenueByCountry(
  instructorId: number | null,
  courseId: number,
  range: AnalyticsRange
): CountryRevenueSummary | null {
  const course = findOwnedCourse(instructorId, courseId);
  if (!course) return null;

  // The same purchases getRevenueSummary counts, narrowed to this course.
  const gross = sql<number>`sum(${purchases.amountPaid})`;
  const rows = db
    .select({
      country: purchases.country,
      purchases: sql<number>`count(*)`,
      gross,
    })
    .from(purchases)
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(
      and(
        eq(purchases.courseId, courseId),
        instructorPurchasesInRange(instructorId, rangeCutoff(range))
      )
    )
    .groupBy(purchases.country)
    .orderBy(desc(gross), sql`${purchases.country} is null`, purchases.country)
    .all();

  const countries = rows.map((row) => ({
    ...row,
    name: countryName(row.country),
    pppDiscountPercent: course.pppEnabled
      ? Math.round(100 * getDiscountForCountry(row.country))
      : 0,
  }));
  const total = (list: CountryRevenue[]) =>
    list.reduce((sum, c) => sum + c.gross, 0);
  const discounted = countries.filter((c) => c.pppDiscountPercent > 0);
  return {
    gross: total(countries),
    pppDiscountedGross: total(discounted),
    fullPriceGross: total(countries) - total(discounted),
    countries,
  };
}

function countryName(code: string | null): string {
  if (code === null) return "Unknown";
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

/** `part` as a whole percentage of `whole`; 0, not NaN, when `whole` is 0. */
function percentOf(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((100 * part) / whole);
}
