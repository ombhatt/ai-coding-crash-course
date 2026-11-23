import { and, asc, count, eq, sql } from "drizzle-orm";
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
  getBadgeDefinition,
  type BadgeDefinition,
  type EarnedBadge,
} from "~/lib/badges";
import { findEnrollment, markEnrollmentComplete } from "./enrollmentService";

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

function isCourseComplete(userId: number, courseId: number) {
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
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .get()!.n;

  return total > 0 && completed === total;
}

// Inserts the badge unless the user already has it. Returns whether it is new.
function award(userId: number, badge: BadgeDefinition, courseId: number | null) {
  const inserted = db
    .insert(userBadges)
    .values({ userId, badgeKey: badge.key, courseId })
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

/**
 * Awards any badges a lesson completion has unlocked and returns only the
 * badges that are new in this call. Call after `markLessonComplete`.
 */
// Modules with at least one lesson where the user has completed every lesson.
// Joining lessons (not left-joining) is what keeps empty modules out.
function countFinishedModules(userId: number) {
  const row = db.get<{ n: number }>(sql`
    select count(*) as n from (
      select ${modules.id}
      from ${modules}
      join ${lessons} on ${lessons.moduleId} = ${modules.id}
      left join ${lessonProgress}
        on ${lessonProgress.lessonId} = ${lessons.id}
        and ${lessonProgress.userId} = ${userId}
        and ${lessonProgress.status} = ${LessonProgressStatus.Completed}
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
  reached: number
): EarnedBadge[] {
  return milestones.flatMap((milestone) => {
    if (reached < milestone.threshold!) return [];
    const row = award(userId, milestone, null);
    return row ? [toEarned(milestone, row, null)] : [];
  });
}

/**
 * Awards any badges a lesson completion has unlocked and returns only the
 * badges that are new in this call, module badges before course badges.
 * Call after `markLessonComplete`.
 */
export function awardBadgesForLessonCompletion(
  userId: number,
  lessonId: number
): EarnedBadge[] {
  if (!isStudent(userId)) return [];

  const newBadges = awardMilestones(
    userId,
    MODULE_MILESTONES,
    countFinishedModules(userId)
  );

  const course = getCourseForLesson(lessonId);
  if (!course || !isCourseComplete(userId, course.id)) return newBadges;

  const enrollment = findEnrollment(userId, course.id);
  if (enrollment && !enrollment.completedAt) {
    markEnrollmentComplete(userId, course.id);
  }

  const finisher = award(userId, COURSE_FINISHER, course.id);
  if (finisher) newBadges.push(toEarned(COURSE_FINISHER, finisher, course.title));

  newBadges.push(
    ...awardMilestones(userId, COURSE_MILESTONES, countFinishedCourses(userId))
  );

  return newBadges;
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
