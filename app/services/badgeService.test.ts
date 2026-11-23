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
});
