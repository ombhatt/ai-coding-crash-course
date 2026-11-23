import { and, asc, count, eq, lte, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  courses,
  lessonProgress,
  lessons,
  LessonProgressStatus,
  modules,
  userBadges,
  UserRole,
  users,
} from "~/db/schema";
import {
  COURSE_FINISHER,
  COURSE_MILESTONES,
  MODULE_MILESTONES,
  STREAK_MILESTONES,
  getBadgeDefinition,
  type BadgeDefinition,
  type BadgeProgress,
  type EarnedBadge,
} from "~/lib/badges";
import { weeklyStreak } from "~/lib/streak";
import { findEnrollment, markEnrollmentComplete } from "./enrollmentService";
import { getLessonProgress } from "./progressService";

function isStudent(userId: number) {
  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return user?.role === UserRole.Student;
}

function getCourseForLesson(lessonId: number) {
  return db
    .select({ id: courses.id, title: courses.title })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

function isCourseComplete(userId: number, courseId: number, asOf: string) {
  const total = db
    .select({ n: count() })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .get()!.n;

  const completed = db
    .select({ n: count() })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        eq(modules.courseId, courseId),
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        lte(lessonProgress.completedAt, asOf)
      )
    )
    .get()!.n;

  return total > 0 && completed === total;
}

// Inserts the badge unless the user already has it. Returns the new row, or
// undefined if the user already had it.
function award(
  userId: number,
  badge: BadgeDefinition,
  courseId: number | null,
  earnedAt: string
) {
  const inserted = db
    .insert(userBadges)
    .values({ userId, badgeKey: badge.key, courseId, earnedAt })
    .onConflictDoNothing()
    .returning()
    .get();
  return inserted;
}

function countFinishedCourses(userId: number) {
  return db
    .select({ n: count() })
    .from(userBadges)
    .where(
      and(
        eq(userBadges.userId, userId),
        eq(userBadges.badgeKey, COURSE_FINISHER.key)
      )
    )
    .get()!.n;
}

function toEarned(
  badge: BadgeDefinition,
  row: { courseId: number | null; earnedAt: string },
  courseTitle: string | null
): EarnedBadge {
  return {
    key: badge.key,
    family: badge.family,
    name: badge.name,
    description: badge.description,
    courseId: row.courseId,
    courseTitle,
    earnedAt: row.earnedAt,
  };
}

// Modules with at least one lesson where the user had completed every lesson
// by `asOf`. Joining lessons (not left-joining) keeps empty modules out.
function countFinishedModules(userId: number, asOf: string) {
  const row = db.get<{ n: number }>(sql`
    select count(*) as n from (
      select ${modules.id}
      from ${modules}
      join ${lessons} on ${lessons.moduleId} = ${modules.id}
      left join ${lessonProgress}
        on ${lessonProgress.lessonId} = ${lessons.id}
        and ${lessonProgress.userId} = ${userId}
        and ${lessonProgress.status} = ${LessonProgressStatus.Completed}
        and ${lessonProgress.completedAt} <= ${asOf}
      group by ${modules.id}
      having count(distinct ${lessons.id}) = count(distinct ${lessonProgress.lessonId})
    )
  `);
  return row.n;
}

// Awards every milestone whose threshold `reached` meets, skipping ones
// already held. Returns only the newly awarded milestones.
function awardMilestones(
  userId: number,
  milestones: BadgeDefinition[],
  reached: number,
  earnedAt: string
): EarnedBadge[] {
  return milestones.flatMap((milestone) => {
    if (reached < milestone.threshold!) return [];
    const row = award(userId, milestone, null, earnedAt);
    return row ? [toEarned(milestone, row, null)] : [];
  });
}

// Badges for finishing the lesson's course; none if the course is unfinished.
// Also marks the enrollment complete the first time the course is finished.
function awardCourseBadges(
  userId: number,
  lessonId: number,
  asOf: string
): EarnedBadge[] {
  const course = getCourseForLesson(lessonId);
  if (!course || !isCourseComplete(userId, course.id, asOf)) return [];

  const enrollment = findEnrollment(userId, course.id);
  if (enrollment && !enrollment.completedAt) {
    markEnrollmentComplete(userId, course.id, asOf);
  }

  const newBadges: EarnedBadge[] = [];
  const finisher = award(userId, COURSE_FINISHER, course.id, asOf);
  if (finisher) newBadges.push(toEarned(COURSE_FINISHER, finisher, course.title));

  newBadges.push(
    ...awardMilestones(
      userId,
      COURSE_MILESTONES,
      countFinishedCourses(userId),
      asOf
    )
  );
  return newBadges;
}

function getCompletionHistory(userId: number): string[] {
  return db
    .select({ completedAt: lessonProgress.completedAt })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .all()
    .flatMap((row) => (row.completedAt ? [row.completedAt] : []));
}

// The weekly streak ending at the week containing `asOf`, counting only
// completions up to `asOf`.
function streakAsOf(userId: number, asOf: string) {
  const history = getCompletionHistory(userId).filter((at) => at <= asOf);
  return weeklyStreak(history, asOf);
}

// Awards what a completion at `asOf` unlocked, counting only completions up to
// that moment and stamping new badges with it. Shared by live awarding and the
// backfill, so both apply the same rules.
function awardBadgesAsOf(
  userId: number,
  lessonId: number,
  asOf: string
): EarnedBadge[] {
  return [
    ...awardMilestones(
      userId,
      MODULE_MILESTONES,
      countFinishedModules(userId, asOf),
      asOf
    ),
    ...awardCourseBadges(userId, lessonId, asOf),
    ...awardMilestones(
      userId,
      STREAK_MILESTONES,
      streakAsOf(userId, asOf),
      asOf
    ),
  ];
}

/**
 * Awards any badges a lesson completion has unlocked and returns only the
 * badges that are new in this call: module, then course, then streak badges.
 * Call after `markLessonComplete`.
 */
export function awardBadgesForLessonCompletion(
  userId: number,
  lessonId: number
): EarnedBadge[] {
  if (!isStudent(userId)) return [];

  const completedAt = getLessonProgress(userId, lessonId)?.completedAt;
  if (!completedAt) return [];
  return awardBadgesAsOf(userId, lessonId, completedAt);
}

/** A user's earned badges, oldest first. */
export function getBadgesForUser(userId: number): EarnedBadge[] {
  const rows = db
    .select({
      badgeKey: userBadges.badgeKey,
      courseId: userBadges.courseId,
      earnedAt: userBadges.earnedAt,
      courseTitle: courses.title,
    })
    .from(userBadges)
    .leftJoin(courses, eq(userBadges.courseId, courses.id))
    .where(eq(userBadges.userId, userId))
    .orderBy(asc(userBadges.earnedAt), asc(userBadges.id))
    .all();

  return rows.flatMap((row) => {
    // A badge whose definition has since been removed is not shown.
    const badge = getBadgeDefinition(row.badgeKey);
    return badge ? [toEarned(badge, row, row.courseTitle)] : [];
  });
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// A streak is still going until a whole week is missed: if this week has no
// completion yet, the streak that ended last week still counts.
function liveStreak(userId: number, now: Date) {
  const history = getCompletionHistory(userId);
  return (
    weeklyStreak(history, now.toISOString()) ||
    weeklyStreak(history, new Date(now.getTime() - WEEK_MS).toISOString())
  );
}

/**
 * For each milestone family, the lowest level the user has not earned yet,
 * with their current count toward it. Families with every level earned are
 * left out, and staff (who cannot earn badges) get nothing.
 */
export function getBadgeProgress(userId: number, now: Date): BadgeProgress[] {
  if (!isStudent(userId)) return [];

  const held = new Set(
    db
      .select({ key: userBadges.badgeKey })
      .from(userBadges)
      .where(eq(userBadges.userId, userId))
      .all()
      .map((row) => row.key)
  );

  const families: [BadgeDefinition[], () => number][] = [
    [COURSE_MILESTONES, () => countFinishedCourses(userId)],
    [MODULE_MILESTONES, () => countFinishedModules(userId, now.toISOString())],
    [STREAK_MILESTONES, () => liveStreak(userId, now)],
  ];

  return families.flatMap(([milestones, current]) => {
    const next = milestones.find((m) => !held.has(m.key));
    if (!next) return [];
    return [
      {
        key: next.key,
        family: next.family,
        name: next.name,
        description: next.description,
        current: current(),
        target: next.threshold!,
      },
    ];
  });
}

/**
 * Awards every badge students have already earned, by replaying each
 * student's lesson completions oldest first through the live awarding rules.
 * Badges are dated to the completion that earned them. Safe to run again:
 * badges already held are skipped. Returns the number of badges awarded.
 */
export function backfillBadges(): number {
  const completions = db
    .select({
      userId: lessonProgress.userId,
      lessonId: lessonProgress.lessonId,
      completedAt: lessonProgress.completedAt,
    })
    .from(lessonProgress)
    .innerJoin(users, eq(lessonProgress.userId, users.id))
    .where(
      and(
        eq(users.role, UserRole.Student),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .orderBy(asc(lessonProgress.completedAt), asc(lessonProgress.id))
    .all();

  let awarded = 0;
  for (const { userId, lessonId, completedAt } of completions) {
    if (!completedAt) continue;
    awarded += awardBadgesAsOf(userId, lessonId, completedAt).length;
  }
  return awarded;
}
