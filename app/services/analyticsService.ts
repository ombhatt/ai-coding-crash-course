import { type AnyColumn, and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import {
  CourseStatus,
  coupons,
  courses,
  enrollments,
  purchases,
  users,
} from "~/db/schema";
import { PLATFORM_FEE_PERCENT } from "~/lib/fees";
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
