// Badge definitions. Plain data so both services and client components can
// import them; icons and colours are mapped per family in the UI.

export enum BadgeFamily {
  Course = "course",
  Module = "module",
  Streak = "streak",
}

export type BadgeDefinition = {
  key: string;
  family: BadgeFamily;
  name: string;
  description: string;
  // Milestone badges are earned once the count reaches `threshold`;
  // per-course badges have none and are earned once per course.
  threshold?: number;
};

export const COURSE_FINISHER_KEY = "course-finisher";

export const COURSE_FINISHER: BadgeDefinition = {
  key: COURSE_FINISHER_KEY,
  family: BadgeFamily.Course,
  name: "Course Finisher",
  description: "Completed every lesson in a course",
};

export const COURSE_MILESTONES: BadgeDefinition[] = [
  {
    key: "courses-1",
    family: BadgeFamily.Course,
    name: "First Finish",
    description: "Finished your first course",
    threshold: 1,
  },
  {
    key: "courses-3",
    family: BadgeFamily.Course,
    name: "Hat Trick",
    description: "Finished 3 courses",
    threshold: 3,
  },
  {
    key: "courses-5",
    family: BadgeFamily.Course,
    name: "Serial Finisher",
    description: "Finished 5 courses",
    threshold: 5,
  },
];

const moduleMilestone = (
  threshold: number,
  name: string
): BadgeDefinition => ({
  key: `modules-${threshold}`,
  family: BadgeFamily.Module,
  name,
  description:
    threshold === 1
      ? "Finished your first module"
      : `Finished ${threshold} modules`,
  threshold,
});

export const MODULE_MILESTONES: BadgeDefinition[] = [
  moduleMilestone(1, "First Module"),
  moduleMilestone(5, "Module Mover"),
  moduleMilestone(10, "Ten Down"),
  moduleMilestone(25, "Quarter Century"),
  moduleMilestone(50, "Half Century"),
];

const streakMilestone = (
  threshold: number,
  name: string
): BadgeDefinition => ({
  key: `streak-${threshold}`,
  family: BadgeFamily.Streak,
  name,
  description: `Completed a lesson ${threshold} weeks in a row`,
  threshold,
});

export const STREAK_MILESTONES: BadgeDefinition[] = [
  streakMilestone(2, "On a Roll"),
  streakMilestone(4, "Habit Formed"),
  streakMilestone(8, "Steady Learner"),
  streakMilestone(12, "Quarter Strong"),
  streakMilestone(26, "Half-Year Habit"),
];

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  COURSE_FINISHER,
  ...COURSE_MILESTONES,
  ...MODULE_MILESTONES,
  ...STREAK_MILESTONES,
];

export function getBadgeDefinition(key: string): BadgeDefinition | undefined {
  return BADGE_DEFINITIONS.find((b) => b.key === key);
}

export type EarnedBadge = {
  key: string;
  family: BadgeFamily;
  name: string;
  description: string;
  courseId: number | null;
  courseTitle: string | null;
  earnedAt: string;
};
