import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "~/db";
import { CourseStatus, courses, purchases } from "~/db/schema";
import { PLATFORM_FEE_PERCENT } from "~/lib/fees";
import type { AnalyticsRange } from "~/lib/analytics";

// ─── Instructor Analytics ───
// Aggregates behind the analytics page. Every figure is grouped SQL over the
// instructor's courses — never a loop over per-student helpers — so the page
// doesn't degrade as an audience grows.

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
  instructorId: number,
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
  instructorId: number,
  cutoff: string | null
) {
  return and(
    eq(courses.instructorId, instructorId),
    cutoff ? gte(purchases.createdAt, cutoff) : undefined
  );
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
  instructorId: number,
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
export function hasPublishedCourses(instructorId: number): boolean {
  const row = db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.instructorId, instructorId),
        eq(courses.status, CourseStatus.Published)
      )
    )
    .limit(1)
    .get();
  return row !== undefined;
}
