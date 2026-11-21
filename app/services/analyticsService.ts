import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "~/db";
import { CourseStatus, courses, purchases } from "~/db/schema";
import { PLATFORM_FEE_PERCENT } from "~/lib/fees";

// ─── Instructor Analytics ───
// Aggregates behind the analytics page. Every figure is grouped SQL over the
// instructor's courses — never a loop over per-student helpers — so the page
// doesn't degrade as an audience grows.

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

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
  const cutoff = rangeCutoff(range);
  const row = db
    .select({ gross: sql<number>`coalesce(sum(${purchases.amountPaid}), 0)` })
    .from(purchases)
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(
      and(
        eq(courses.instructorId, instructorId),
        cutoff ? gte(purchases.createdAt, cutoff) : undefined
      )
    )
    .get();

  const gross = row?.gross ?? 0;
  // Rounded once on the total, so the fee can't drift from the summed
  // per-purchase roundings; net takes the remainder so the three always add up.
  const fee = Math.round((gross * PLATFORM_FEE_PERCENT) / 100);
  return { gross, fee, net: gross - fee };
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
