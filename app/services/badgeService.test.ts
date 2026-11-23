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

function completeLesson(userId: number, lessonId: number) {
  markLessonComplete(userId, lessonId);
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
        ["course-finisher", "courses-1"],
        ["course-finisher"],
        ["course-finisher", "courses-3"],
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
        { name: "Course Finisher", courseTitle: "Test Course" },
        { name: "First Finish", courseTitle: null },
      ]);
    });

    it("returns an empty list for a student with no badges", () => {
      expect(getBadgesForUser(base.user.id)).toEqual([]);
    });
  });
});
