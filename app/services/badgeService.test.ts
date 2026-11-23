import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the modules pick up our test db
import {
  awardBadgesForLessonCompletion,
  backfillBadges,
  getBadgeProgress,
  getBadgesForUser,
} from "./badgeService";
import { markLessonComplete, resetLessonProgress } from "./progressService";
import { enrollUser, findEnrollment } from "./enrollmentService";

function createLessons(courseId: number, lessonCount: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module 1", position: 1 })
    .returning()
    .get();

  return Array.from({ length: lessonCount }, (_, i) =>
    testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
      .returning()
      .get()
  );
}

function createCourse(slug: string) {
  return testDb
    .insert(schema.courses)
    .values({
      title: slug,
      slug,
      description: slug,
      salesCopy: slug,
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function completeLesson(userId: number, lessonId: number) {
  markLessonComplete(userId, lessonId);
  return awardBadgesForLessonCompletion(userId, lessonId);
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Records a completion `weeksAgo` weeks before now, as history for streaks.
function completedWeeksAgo(userId: number, lessonId: number, weeksAgo: number) {
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt: new Date(Date.now() - weeksAgo * WEEK_MS).toISOString(),
    })
    .run();
}

// Records a completion at a fixed time, without awarding anything — as if it
// happened before badges existed.
function completedAt(userId: number, lessonId: number, at: string) {
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt: at,
    })
    .run();
}

// Completes a lesson `weeksAgo` weeks before now and awards badges for it,
// as if the student had clicked "Mark as Complete" back then.
function completeLessonWeeksAgo(
  userId: number,
  lessonId: number,
  weeksAgo: number
) {
  completedWeeksAgo(userId, lessonId, weeksAgo);
  return awardBadgesForLessonCompletion(userId, lessonId);
}

describe("badgeService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("awardBadgesForLessonCompletion", () => {
    it("awards the course badge and first-finish milestone when a student completes a course's final lesson", () => {
      const lessons = createLessons(base.course.id, 2);
      enrollUser(base.user.id, base.course.id, false, false);

      completeLesson(base.user.id, lessons[0].id);
      const newBadges = completeLesson(base.user.id, lessons[1].id);

      expect(
        newBadges.map((b) => ({ key: b.key, courseTitle: b.courseTitle }))
      ).toEqual([
        { key: "modules-1", courseTitle: null },
        { key: "course-finisher", courseTitle: "Test Course" },
        { key: "courses-1", courseTitle: null },
      ]);
    });

    it("marks the enrollment complete when a student finishes the course", () => {
      const lessons = createLessons(base.course.id, 1);
      enrollUser(base.user.id, base.course.id, false, false);

      completeLesson(base.user.id, lessons[0].id);

      expect(findEnrollment(base.user.id, base.course.id)?.completedAt).toEqual(
        expect.any(String)
      );
    });

    it("awards nothing while lessons in the course are still unfinished", () => {
      const lessons = createLessons(base.course.id, 2);
      enrollUser(base.user.id, base.course.id, false, false);

      expect(completeLesson(base.user.id, lessons[1].id)).toEqual([]);
    });

    it("awards nothing new when a finished course's last lesson is reset and completed again", () => {
      const lessons = createLessons(base.course.id, 1);
      enrollUser(base.user.id, base.course.id, false, false);
      completeLesson(base.user.id, lessons[0].id);

      resetLessonProgress(base.user.id, lessons[0].id);

      expect(completeLesson(base.user.id, lessons[0].id)).toEqual([]);
    });

    it.each([schema.UserRole.Instructor, schema.UserRole.Admin])(
      "awards nothing to a %s who completes every lesson",
      (role) => {
        const staff = testDb
          .insert(schema.users)
          .values({ name: "Staff", email: `${role}@staff.test`, role })
          .returning()
          .get();
        const lessons = createLessons(base.course.id, 1);
        enrollUser(staff.id, base.course.id, false, false);

        expect(completeLesson(staff.id, lessons[0].id)).toEqual([]);
      }
    );

    it("awards the three-course milestone when a student finishes a third course", () => {
      const courseIds = [base.course.id];
      for (const slug of ["second-course", "third-course"]) {
        const course = testDb
          .insert(schema.courses)
          .values({
            title: slug,
            slug,
            description: slug,
            salesCopy: slug,
            instructorId: base.instructor.id,
            categoryId: base.category.id,
            status: schema.CourseStatus.Published,
          })
          .returning()
          .get();
        courseIds.push(course.id);
      }

      const results = courseIds.map((courseId) => {
        const [lesson] = createLessons(courseId, 1);
        enrollUser(base.user.id, courseId, false, false);
        return completeLesson(base.user.id, lesson.id).map((b) => b.key);
      });

      expect(results).toEqual([
        ["modules-1", "course-finisher", "courses-1"],
        ["course-finisher"],
        ["course-finisher", "courses-3"],
      ]);
    });
  });

  describe("module milestones", () => {
    it("awards the first-module milestone when a student finishes a module but not the course", () => {
      const firstModule = createLessons(base.course.id, 2);
      createLessons(base.course.id, 1);
      enrollUser(base.user.id, base.course.id, false, false);

      completeLesson(base.user.id, firstModule[0].id);
      const newBadges = completeLesson(base.user.id, firstModule[1].id);

      expect(newBadges.map((b) => b.key)).toEqual(["modules-1"]);
    });

    it("counts modules finished across different courses toward the five-module milestone", () => {
      // Each course gets a second, unfinished module so no course completes.
      const finishedModules = ["a", "b", "c", "d", "e"].map((slug) => {
        const course = createCourse(slug);
        enrollUser(base.user.id, course.id, false, false);
        createLessons(course.id, 1);
        return createLessons(course.id, 1);
      });

      const results = finishedModules.map(([lesson]) =>
        completeLesson(base.user.id, lesson.id).map((b) => b.key)
      );

      expect(results).toEqual([["modules-1"], [], [], [], ["modules-5"]]);
    });

    it("awards module and course badges together, module first, when one lesson finishes both", () => {
      const [lesson] = createLessons(base.course.id, 1);
      enrollUser(base.user.id, base.course.id, false, false);

      expect(
        completeLesson(base.user.id, lesson.id).map((b) => b.family)
      ).toEqual(["module", "course", "course"]);
    });

    it("does not count empty modules toward a milestone", () => {
      const lessons = createLessons(base.course.id, 1);
      createLessons(base.course.id, 1); // keeps the course unfinished
      createLessons(base.course.id, 0);
      createLessons(base.course.id, 0);
      createLessons(base.course.id, 0);
      createLessons(base.course.id, 0);
      enrollUser(base.user.id, base.course.id, false, false);

      expect(
        completeLesson(base.user.id, lessons[0].id).map((b) => b.key)
      ).toEqual(["modules-1"]);
    });

    it("awards nothing new when a finished module's lesson is reset and completed again", () => {
      const lessons = createLessons(base.course.id, 1);
      createLessons(base.course.id, 1); // keeps the course unfinished
      enrollUser(base.user.id, base.course.id, false, false);
      completeLesson(base.user.id, lessons[0].id);

      resetLessonProgress(base.user.id, lessons[0].id);

      expect(completeLesson(base.user.id, lessons[0].id)).toEqual([]);
    });
  });

  describe("weekly streaks", () => {
    // One module with spare lessons, so no module or course badge interferes.
    let lessons: ReturnType<typeof createLessons>;
    beforeEach(() => {
      lessons = createLessons(base.course.id, 5);
      enrollUser(base.user.id, base.course.id, false, false);
    });

    it("awards the two-week streak for a completion last week and one now", () => {
      completedWeeksAgo(base.user.id, lessons[0].id, 1);

      expect(
        completeLesson(base.user.id, lessons[1].id).map((b) => b.key)
      ).toEqual(["streak-2"]);
    });

    it("awards nothing new for another completion in the same week", () => {
      completedWeeksAgo(base.user.id, lessons[0].id, 1);
      completeLesson(base.user.id, lessons[1].id);

      expect(completeLesson(base.user.id, lessons[2].id)).toEqual([]);
    });

    it("keeps an earned streak badge after the streak breaks", () => {
      completedWeeksAgo(base.user.id, lessons[0].id, 4);
      completeLessonWeeksAgo(base.user.id, lessons[1].id, 3);
      // two weeks missed

      expect(completeLesson(base.user.id, lessons[2].id)).toEqual([]);
      expect(getBadgesForUser(base.user.id).map((b) => b.key)).toEqual([
        "streak-2",
      ]);
    });
  });

  describe("getBadgesForUser", () => {
    it("lists the badges a student has earned, with the course they belong to", () => {
      const lessons = createLessons(base.course.id, 1);
      enrollUser(base.user.id, base.course.id, false, false);
      completeLesson(base.user.id, lessons[0].id);

      expect(
        getBadgesForUser(base.user.id).map((b) => ({
          name: b.name,
          courseTitle: b.courseTitle,
        }))
      ).toEqual([
        { name: "First Module", courseTitle: null },
        { name: "Course Finisher", courseTitle: "Test Course" },
        { name: "First Finish", courseTitle: null },
      ]);
    });

    it("returns an empty list for a student with no badges", () => {
      expect(getBadgesForUser(base.user.id)).toEqual([]);
    });
  });

  describe("getBadgeProgress", () => {
    const progressOf = (userId: number) =>
      getBadgeProgress(userId, new Date()).map((p) => ({
        name: p.name,
        current: p.current,
        target: p.target,
      }));

    it.each([schema.UserRole.Instructor, schema.UserRole.Admin])(
      "shows a %s no progress, since staff cannot earn badges",
      (role) => {
        const staff = testDb
          .insert(schema.users)
          .values({ name: "Staff", email: `${role}@staff.test`, role })
          .returning()
          .get();

        expect(progressOf(staff.id)).toEqual([]);
      }
    );

    it("shows a new student the first level of every family at zero", () => {
      expect(progressOf(base.user.id)).toEqual([
        { name: "First Finish", current: 0, target: 1 },
        { name: "First Module", current: 0, target: 1 },
        { name: "On a Roll", current: 0, target: 2 },
      ]);
    });

    it("counts finished modules toward the next module level once the first is earned", () => {
      createLessons(base.course.id, 1); // keeps the course unfinished
      enrollUser(base.user.id, base.course.id, false, false);
      for (let i = 0; i < 3; i++) {
        const [lesson] = createLessons(base.course.id, 1);
        completeLesson(base.user.id, lesson.id);
      }

      expect(
        progressOf(base.user.id).find((p) => p.name.startsWith("Module"))
      ).toEqual({ name: "Module Mover", current: 3, target: 5 });
    });

    it("leaves out a family once every level in it is earned", () => {
      for (const slug of ["c1", "c2", "c3", "c4", "c5"]) {
        const course = createCourse(slug);
        const [lesson] = createLessons(course.id, 1);
        enrollUser(base.user.id, course.id, false, false);
        completeLesson(base.user.id, lesson.id);
      }

      // Five single-module courses also finish five modules.
      expect(progressOf(base.user.id).map((p) => p.name)).toEqual([
        "Ten Down",
        "On a Roll",
      ]);
    });

    it("counts a streak that ended last week as still going", () => {
      const lessons = createLessons(base.course.id, 5);
      enrollUser(base.user.id, base.course.id, false, false);
      completeLessonWeeksAgo(base.user.id, lessons[0].id, 2);
      completeLessonWeeksAgo(base.user.id, lessons[1].id, 1);

      expect(
        progressOf(base.user.id).find((p) => p.name === "Habit Formed")
      ).toEqual({ name: "Habit Formed", current: 2, target: 4 });
    });

    it("shows a streak as zero once a whole week has been missed", () => {
      const lessons = createLessons(base.course.id, 5);
      enrollUser(base.user.id, base.course.id, false, false);
      completeLessonWeeksAgo(base.user.id, lessons[0].id, 2);

      expect(
        progressOf(base.user.id).find((p) => p.name === "On a Roll")
      ).toEqual({ name: "On a Roll", current: 0, target: 2 });
    });
  });

  describe("backfillBadges", () => {
    // Monday of one week, then Tuesday of the next.
    const MODULE_DONE = "2026-10-05T09:00:00.000Z";
    const COURSE_DONE = "2026-10-13T09:00:00.000Z";

    it("awards badges from past completions, dated to the completion that earned each", () => {
      const [first] = createLessons(base.course.id, 1);
      const [second] = createLessons(base.course.id, 1);
      enrollUser(base.user.id, base.course.id, false, false);
      completedAt(base.user.id, first.id, MODULE_DONE);
      completedAt(base.user.id, second.id, COURSE_DONE);

      backfillBadges();

      expect(
        getBadgesForUser(base.user.id).map((b) => [b.key, b.earnedAt])
      ).toEqual([
        ["modules-1", MODULE_DONE],
        ["course-finisher", COURSE_DONE],
        ["courses-1", COURSE_DONE],
        ["streak-2", COURSE_DONE],
      ]);
    });

    it("awards nothing and changes nothing when run a second time", () => {
      const [lesson] = createLessons(base.course.id, 1);
      enrollUser(base.user.id, base.course.id, false, false);
      completedAt(base.user.id, lesson.id, COURSE_DONE);
      backfillBadges();
      const before = getBadgesForUser(base.user.id);

      expect(backfillBadges()).toBe(0);
      expect(getBadgesForUser(base.user.id)).toEqual(before);
    });

    it("gives instructors and admins no badges", () => {
      const admin = testDb
        .insert(schema.users)
        .values({
          name: "Admin",
          email: "admin@staff.test",
          role: schema.UserRole.Admin,
        })
        .returning()
        .get();
      const [lesson] = createLessons(base.course.id, 1);
      for (const staffId of [base.instructor.id, admin.id]) {
        enrollUser(staffId, base.course.id, false, false);
        completedAt(staffId, lesson.id, COURSE_DONE);
      }

      expect(backfillBadges()).toBe(0);
      expect(getBadgesForUser(base.instructor.id)).toEqual([]);
      expect(getBadgesForUser(admin.id)).toEqual([]);
    });

    it("marks a finished course's enrollment complete at the time it was finished", () => {
      const [first] = createLessons(base.course.id, 1);
      const [second] = createLessons(base.course.id, 1);
      enrollUser(base.user.id, base.course.id, false, false);
      completedAt(base.user.id, first.id, MODULE_DONE);
      completedAt(base.user.id, second.id, COURSE_DONE);

      backfillBadges();

      expect(findEnrollment(base.user.id, base.course.id)?.completedAt).toBe(
        COURSE_DONE
      );
    });
  });
});
