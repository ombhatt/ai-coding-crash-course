import { eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../app/db/schema";
import {
  UserRole,
  CourseStatus,
  LessonProgressStatus,
  QuestionType,
  TeamMemberRole,
} from "../app/db/schema";
import { calculatePppPrice } from "../app/lib/ppp";
import {
  type LessonSpec,
  type ModuleSpec,
  TYPESCRIPT_SALES_COPY,
  TYPESCRIPT_MODULES,
  NODE_SALES_COPY,
  NODE_MODULES,
  CSS_SALES_COPY,
  CSS_MODULES,
  DOCKER_SALES_COPY,
  DOCKER_MODULES,
  TYPE_LEVEL_SALES_COPY,
  TYPE_LEVEL_MODULES,
} from "./seed-content";

export type SeedDb = BetterSQLite3Database<typeof schema>;

// ─── Helpers ───

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO timestamp `n` days before now. Fractional days are allowed. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

/**
 * mulberry32 — a tiny deterministic PRNG. A fixed seed means every reseed
 * plants the same shapes (counts, funnels, relative dates — all anchored to
 * today), so QA can check the dashboard against known answers.
 */
function createRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function emailFor(name: string, domain = "student.dev") {
  return `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${domain}`;
}

function avatarFor(name: string) {
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(name.split(" ")[0].toLowerCase())}`;
}

// ─── Catalog ───

// "docker" is published but never sold; "typeLevel" is a draft. Both exist so
// the dashboard's zero-sales and draft states are reachable.
type CourseKey = "typescript" | "node" | "css" | "docker" | "typeLevel";

type CourseSpec = {
  title: string;
  slug: string;
  description: string;
  salesCopy: string;
  instructorEmail: string;
  categorySlug: string;
  status: CourseStatus;
  coverImageUrl: string | null;
  price: number;
  createdDaysAgo: number;
  updatedDaysAgo: number;
  modules: ModuleSpec[];
};

const SARAH = "sarah.chen@ralph.dev";
const MARCUS = "marcus.johnson@ralph.dev";
const PRIYA = "priya.natarajan@ralph.dev";
// An instructor with no courses, so the dashboard's empty state is reachable.
const DANA = "dana.okafor@ralph.dev";

const COURSES: Record<CourseKey, CourseSpec> = {
  typescript: {
    title: "Introduction to TypeScript",
    slug: "introduction-to-typescript",
    description:
      "Master TypeScript from the ground up. Learn type annotations, interfaces, generics, and advanced patterns that will make your JavaScript code safer and more maintainable. Includes hands-on projects and real-world examples.",
    salesCopy: TYPESCRIPT_SALES_COPY,
    instructorEmail: SARAH,
    categorySlug: "programming",
    status: CourseStatus.Published,
    coverImageUrl: "/images/course-typescript.svg",
    price: 4999,
    createdDaysAgo: 365,
    updatedDaysAgo: 10,
    modules: TYPESCRIPT_MODULES,
  },
  node: {
    title: "Building REST APIs with Node.js",
    slug: "building-rest-apis-with-nodejs",
    description:
      "Learn to build production-ready REST APIs using Node.js and Express. Covers routing, middleware, authentication, database integration, error handling, testing, and deployment best practices.",
    salesCopy: NODE_SALES_COPY,
    instructorEmail: MARCUS,
    categorySlug: "programming",
    status: CourseStatus.Published,
    coverImageUrl: "/images/course-nodejs.svg",
    price: 5999,
    createdDaysAgo: 330,
    updatedDaysAgo: 5,
    modules: NODE_MODULES,
  },
  css: {
    title: "CSS Layout Mastery",
    slug: "css-layout-mastery",
    description:
      "Flexbox and Grid from first principles. Learn which layout tool fits which problem, and build responsive layouts without fighting the cascade.",
    salesCopy: CSS_SALES_COPY,
    instructorEmail: PRIYA,
    categorySlug: "design",
    status: CourseStatus.Published,
    coverImageUrl: null,
    price: 3999,
    createdDaysAgo: 200,
    updatedDaysAgo: 30,
    modules: CSS_MODULES,
  },
  docker: {
    title: "Docker for Developers",
    slug: "docker-for-developers",
    description:
      "Containerise a real application step by step: images, containers, volumes, networking and Compose.",
    salesCopy: DOCKER_SALES_COPY,
    instructorEmail: MARCUS,
    categorySlug: "devops",
    status: CourseStatus.Published,
    coverImageUrl: null,
    price: 2999,
    createdDaysAgo: 60,
    updatedDaysAgo: 20,
    modules: DOCKER_MODULES,
  },
  typeLevel: {
    title: "Type-Level TypeScript",
    slug: "type-level-typescript",
    description:
      "Go beyond everyday types: conditional types, infer, recursion and building your own utility types.",
    salesCopy: TYPE_LEVEL_SALES_COPY,
    instructorEmail: SARAH,
    categorySlug: "programming",
    status: CourseStatus.Draft,
    coverImageUrl: null,
    price: 6999,
    createdDaysAgo: 20,
    updatedDaysAgo: 2,
    modules: TYPE_LEVEL_MODULES,
  },
};

/** Lesson titles per course, in course order. */
const COURSE_LESSON_TITLES = Object.fromEntries(
  Object.entries(COURSES).map(([key, spec]) => [
    key,
    spec.modules.flatMap((m) => m.lessons.map((l) => l.title)),
  ])
) as Record<CourseKey, string[]>;

/** The lesson in each sold course where completions fall off a cliff. */
const CLIFF_LESSONS: Partial<Record<CourseKey, string>> = {
  typescript: "Generics Basics",
  node: "JWT Authentication",
  css: "Grid Tracks and Units",
};

/**
 * Planted drop-off cliffs. Completions decline gently through each course,
 * then fall to under half of the previous lesson's at these lessons — so the
 * per-lesson funnel can be checked against a known answer.
 */
export const DROP_OFF_CLIFFS = Object.entries(CLIFF_LESSONS).map(
  ([key, lessonTitle]) => ({
    courseSlug: COURSES[key as CourseKey].slug,
    lessonTitle: lessonTitle!,
  })
);

// ─── People ───

const EMMA = "emma.wilson@student.dev";
const JAMES = "james.park@student.dev";
const OLIVIA = "olivia.martinez@student.dev";
const LIAM = "liam.thompson@student.dev";
const SOPHIA = "sophia.davis@student.dev";
const BOSSY = "bossy.mcbossface@student.dev";
const GRACE = "grace.kim@northwind.dev";
const HENRY = "henry.adams@acme.dev";

/** Students who buy courses themselves. [name, home country] */
const BUYERS: [string, string][] = [
  ["Noah Garcia", "US"],
  ["Ava Nguyen", "VN"],
  ["Ethan Brown", "GB"],
  ["Mia Rossi", "US"],
  ["Lucas Silva", "BR"],
  ["Isabella Kowalski", "PL"],
  ["Mason Lee", "US"],
  ["Amara Okafor", "NG"],
  ["Elijah Wright", "CA"],
  ["Harper Singh", "IN"],
  ["Logan Murphy", "US"],
  ["Chloe Dubois", "FR"],
  ["Aiden Patel", "IN"],
  ["Zoe Schmidt", "DE"],
  ["Caleb Rivera", "MX"],
  ["Lily Tanaka", "JP"],
  ["Jackson Hall", "US"],
  ["Nora Jensen", "NO"],
  ["Owen Clarke", "AU"],
  ["Aria Fernandez", "AR"],
  ["Wyatt King", "US"],
  ["Hana Sato", "JP"],
  ["Leo Martins", "BR"],
  ["Maya Cohen", "US"],
  ["Kofi Mensah", "US"],
  ["Ella Novak", "CZ"],
  ["Ryan Obrien", "GB"],
  ["Priyanka Das", "BD"],
];

/** Students who only ever get a course through a team seat. */
const SEAT_HOLDERS = [
  "Samuel Reed",
  "Fatima Ali",
  "Tomas Ortega",
  "Julia Becker",
  "Ben Carter",
  "Ivy Chen",
];

type TeamSpec = {
  buyerEmail: string;
  course: CourseKey;
  seats: number;
  daysAgo: number;
  country: string;
  // Redeemers are named by email, never by array position, so adding people
  // to the lists above can't silently re-point a redemption.
  redemptions: { email: string; daysAgo: number }[];
};

const TEAMS: TeamSpec[] = [
  {
    buyerEmail: BOSSY,
    course: "node",
    seats: 5,
    daysAgo: 33.4,
    country: "US",
    redemptions: [
      { email: OLIVIA, daysAgo: 32.2 },
      { email: LIAM, daysAgo: 25.2 },
    ],
  },
  {
    buyerEmail: GRACE,
    course: "typescript",
    seats: 8,
    daysAgo: 75.4,
    country: "GB",
    redemptions: [
      { email: emailFor("Samuel Reed"), daysAgo: 70.2 },
      { email: emailFor("Fatima Ali"), daysAgo: 60.2 },
      { email: emailFor("Tomas Ortega"), daysAgo: 41.2 },
      { email: emailFor("Julia Becker"), daysAgo: 18.2 },
      { email: emailFor("Ben Carter"), daysAgo: 3.2 },
    ],
  },
  {
    buyerEmail: HENRY,
    course: "css",
    seats: 4,
    daysAgo: 12.4,
    country: "DE",
    redemptions: [{ email: emailFor("Ivy Chen"), daysAgo: 6.2 }],
  },
];

type PurchasePlan = {
  email: string;
  course: CourseKey;
  daysAgo: number;
  country: string;
};

/** Hand-written purchases for the named students the lesson comments use. */
const NAMED_PURCHASES: PurchasePlan[] = [
  { email: EMMA, course: "typescript", daysAgo: 50.3, country: "US" },
  { email: EMMA, course: "node", daysAgo: 40.3, country: "US" },
  { email: JAMES, course: "typescript", daysAgo: 45.3, country: "IN" },
  { email: OLIVIA, course: "typescript", daysAgo: 35.3, country: "US" },
  { email: SOPHIA, course: "typescript", daysAgo: 15.3, country: "US" },
];

/**
 * Purchases for the BUYERS cohort, spread over the last 12 months and skewed
 * toward recent months (a growing catalog), so every revenue window differs.
 */
function planCohortPurchases(): PurchasePlan[] {
  const random = createRandom(4242);
  const weighted: CourseKey[] = [
    "typescript",
    "typescript",
    "typescript",
    "node",
    "node",
    "css",
  ];
  const pickCourse = (exclude?: CourseKey) => {
    const options = weighted.filter((c) => c !== exclude);
    return options[Math.floor(random() * options.length)];
  };
  const dayWithin = (course: CourseKey, upTo: number) =>
    Math.min(0.3 + upTo * Math.pow(random(), 1.4), COURSES[course].createdDaysAgo - 1);

  const plans: PurchasePlan[] = [];
  BUYERS.forEach(([name, country], i) => {
    const email = emailFor(name);
    const first = pickCourse();
    const firstDay = dayWithin(first, 364);
    plans.push({ email, course: first, daysAgo: firstDay, country });

    // Three in four come back for a second course later on.
    if (i % 4 !== 3) {
      const second = pickCourse(first);
      plans.push({
        email,
        course: second,
        daysAgo: Math.min(firstDay * (0.1 + 0.6 * random()), COURSES[second].createdDaysAgo - 1),
        country,
      });
    }
  });
  return plans.map((p) => ({ ...p, daysAgo: clearOfWindowEdges(p.daysAgo) }));
}

/**
 * Dashboards may cut revenue windows at "now − N days" or at the start of a
 * calendar day. Keeping purchases 1.5+ days clear of the 7/30/90-day edges
 * means both readings put every purchase in the same window.
 */
function clearOfWindowEdges(day: number) {
  for (const edge of [7, 30, 90]) {
    if (Math.abs(day - edge) < 1.5) return day >= edge ? edge + 1.6 : edge - 1.6;
  }
  return day;
}

// ─── Seed ───

export function seedDatabase(db: SeedDb) {
  const purchasePlans = [...NAMED_PURCHASES, ...planCohortPurchases()];

  // ─── Users ───

  /** Days ago of each user's earliest purchase or redemption. */
  const firstActivity = new Map<string, number>();
  const noteActivity = (email: string, day: number) =>
    firstActivity.set(email, Math.max(firstActivity.get(email) ?? 0, day));
  purchasePlans.forEach((p) => noteActivity(p.email, p.daysAgo));
  TEAMS.forEach((t) => {
    noteActivity(t.buyerEmail, t.daysAgo);
    t.redemptions.forEach((r) => noteActivity(r.email, r.daysAgo));
  });
  const signedUp = (email: string) => daysAgo((firstActivity.get(email) ?? 0) + 2);

  const userByEmail = new Map<string, typeof schema.users.$inferSelect>();
  function insertUser(values: typeof schema.users.$inferInsert) {
    const row = db.insert(schema.users).values(values).returning().get();
    userByEmail.set(row.email, row);
    return row;
  }

  const admin = insertUser({
    name: "Alex Rivera",
    email: "alex.rivera@ralph.dev",
    role: UserRole.Admin,
    avatarUrl: avatarFor("Alex Rivera"),
    createdAt: daysAgo(420),
  });

  const sarah = insertUser({
    name: "Sarah Chen",
    email: SARAH,
    role: UserRole.Instructor,
    avatarUrl: avatarFor("Sarah Chen"),
    bio: "Senior TypeScript engineer with 10 years of experience building large-scale web applications. Previously at Stripe and Vercel. Passionate about type safety and developer tooling.",
    createdAt: daysAgo(400),
  });

  const marcus = insertUser({
    name: "Marcus Johnson",
    email: MARCUS,
    role: UserRole.Instructor,
    avatarUrl: avatarFor("Marcus Johnson"),
    bio: "Full-stack developer and API architect specializing in Node.js and cloud infrastructure. Has built and scaled APIs serving millions of requests daily. Conference speaker and open-source contributor.",
    createdAt: daysAgo(380),
  });

  insertUser({
    name: "Priya Natarajan",
    email: PRIYA,
    role: UserRole.Instructor,
    avatarUrl: avatarFor("Priya Natarajan"),
    bio: "Design engineer who has spent a decade turning mockups into resilient, responsive interfaces. Believes every layout bug is a mental-model bug.",
    createdAt: daysAgo(220),
  });

  insertUser({
    name: "Dana Okafor",
    email: DANA,
    role: UserRole.Instructor,
    avatarUrl: avatarFor("Dana Okafor"),
    bio: "Data engineer preparing a first course on SQL for analysts.",
    createdAt: daysAgo(14),
  });

  const namedStudents: [string, string][] = [
    ["Emma Wilson", EMMA],
    ["James Park", JAMES],
    ["Olivia Martinez", OLIVIA],
    ["Liam Thompson", LIAM],
    ["Sophia Davis", SOPHIA],
    ["Bossy McBossface", BOSSY],
    ["Grace Kim", GRACE],
    ["Henry Adams", HENRY],
  ];
  const cohort: [string, string][] = [
    ...BUYERS.map(([name]) => [name, emailFor(name)] as [string, string]),
    ...SEAT_HOLDERS.map((name) => [name, emailFor(name)] as [string, string]),
  ];

  for (const [name, email] of [...namedStudents, ...cohort]) {
    insertUser({
      name,
      email,
      role: UserRole.Student,
      avatarUrl: avatarFor(name),
      createdAt: signedUp(email),
    });
  }
  function user(email: string) {
    const found = userByEmail.get(email);
    if (!found) throw new Error(`Seed references unknown user ${email}`);
    return found;
  }

  const emma = user(EMMA);
  const james = user(JAMES);
  const olivia = user(OLIVIA);
  const liam = user(LIAM);
  const sophia = user(SOPHIA);

  // ─── Categories ───

  const categoriesData = db
    .insert(schema.categories)
    .values([
      { name: "Programming", slug: "programming" },
      { name: "Design", slug: "design" },
      { name: "Data Science", slug: "data-science" },
      { name: "DevOps", slug: "devops" },
      { name: "Marketing", slug: "marketing" },
    ])
    .returning()
    .all();
  const catBySlug = Object.fromEntries(categoriesData.map((c) => [c.slug, c]));

  // ─── Courses, modules, lessons ───

  const courses = {} as Record<CourseKey, typeof schema.courses.$inferSelect>;
  const lessonIds = {} as Record<CourseKey, number[]>;

  for (const key of Object.keys(COURSES) as CourseKey[]) {
    const spec = COURSES[key];
    const course = db
      .insert(schema.courses)
      .values({
        title: spec.title,
        slug: spec.slug,
        description: spec.description,
        salesCopy: spec.salesCopy,
        instructorId: user(spec.instructorEmail).id,
        categoryId: catBySlug[spec.categorySlug].id,
        status: spec.status,
        coverImageUrl: spec.coverImageUrl,
        price: spec.price,
        createdAt: daysAgo(spec.createdDaysAgo),
        updatedAt: daysAgo(spec.updatedDaysAgo),
      })
      .returning()
      .get();
    courses[key] = course;
    lessonIds[key] = [];

    spec.modules.forEach((modData, mi) => {
      const mod = db
        .insert(schema.modules)
        .values({
          courseId: course.id,
          title: modData.title,
          position: mi + 1,
          createdAt: daysAgo(spec.createdDaysAgo - mi),
        })
        .returning()
        .get();

      modData.lessons.forEach((lessonData, li) => {
        const lesson = db
          .insert(schema.lessons)
          .values({
            moduleId: mod.id,
            title: lessonData.title,
            content: lessonData.content,
            videoUrl: lessonData.videoUrl ?? null,
            githubRepoUrl: lessonData.githubRepoUrl ?? null,
            position: li + 1,
            durationMinutes: lessonData.duration,
            createdAt: daysAgo(spec.createdDaysAgo - mi),
          })
          .returning()
          .get();
        lessonIds[key].push(lesson.id);
      });
    });
  }

  const tsLessons = lessonIds.typescript;
  const nodeLessons = lessonIds.node;
  function lessonByTitle(course: CourseKey, title: string) {
    const index = COURSE_LESSON_TITLES[course].indexOf(title);
    if (index === -1) throw new Error(`No lesson "${title}" in ${course}`);
    return lessonIds[course][index];
  }
  const genericsLesson = lessonByTitle("typescript", "Generics Basics");

  // ─── Quizzes ───

  type QuizQuestionSpec = {
    text: string;
    type: QuestionType;
    options: { text: string; correct: boolean }[];
  };
  type QuizOptionRef = { questionId: number; optionId: number; correct: boolean };

  function createQuiz(
    lessonId: number,
    title: string,
    passingScore: number,
    questions: QuizQuestionSpec[]
  ) {
    const quiz = db
      .insert(schema.quizzes)
      .values({ lessonId, title, passingScore })
      .returning()
      .get();
    const optionIds: QuizOptionRef[] = [];
    questions.forEach((q, qi) => {
      const question = db
        .insert(schema.quizQuestions)
        .values({
          quizId: quiz.id,
          questionText: q.text,
          questionType: q.type,
          position: qi + 1,
        })
        .returning()
        .get();
      for (const opt of q.options) {
        const option = db
          .insert(schema.quizOptions)
          .values({
            questionId: question.id,
            optionText: opt.text,
            isCorrect: opt.correct,
          })
          .returning()
          .get();
        optionIds.push({
          questionId: question.id,
          optionId: option.id,
          correct: opt.correct,
        });
      }
    });
    return { quiz, optionIds };
  }

  const quizBasics = createQuiz(
    lessonByTitle("typescript", "Your First TypeScript Program"),
    "TypeScript Basics Quiz",
    0.7,
    [
      {
        text: "What does TypeScript compile to?",
        type: QuestionType.MultipleChoice,
        options: [
          { text: "JavaScript", correct: true },
          { text: "WebAssembly", correct: false },
          { text: "Java bytecode", correct: false },
          { text: "Machine code", correct: false },
        ],
      },
      {
        text: "TypeScript is a superset of JavaScript.",
        type: QuestionType.TrueFalse,
        options: [
          { text: "True", correct: true },
          { text: "False", correct: false },
        ],
      },
      {
        text: "Which file configures the TypeScript compiler?",
        type: QuestionType.MultipleChoice,
        options: [
          { text: "tsconfig.json", correct: true },
          { text: "package.json", correct: false },
          { text: "typescript.config.js", correct: false },
          { text: ".tsrc", correct: false },
        ],
      },
    ]
  );

  const quizGenerics = createQuiz(
    genericsLesson,
    "Generics Knowledge Check",
    0.6,
    [
      {
        text: "What is the primary benefit of generics?",
        type: QuestionType.MultipleChoice,
        options: [
          { text: "Code reusability with type safety", correct: true },
          { text: "Faster execution speed", correct: false },
          { text: "Smaller bundle size", correct: false },
          { text: "Better error messages", correct: false },
        ],
      },
      {
        text: "Generic type parameters can be constrained using the 'extends' keyword.",
        type: QuestionType.TrueFalse,
        options: [
          { text: "True", correct: true },
          { text: "False", correct: false },
        ],
      },
    ]
  );

  const quizHttp = createQuiz(
    lessonByTitle("node", "HTTP Methods and Status Codes"),
    "HTTP Methods Quiz",
    0.7,
    [
      {
        text: "Which HTTP method is used to create a new resource?",
        type: QuestionType.MultipleChoice,
        options: [
          { text: "POST", correct: true },
          { text: "GET", correct: false },
          { text: "PUT", correct: false },
          { text: "PATCH", correct: false },
        ],
      },
      {
        text: "A 404 status code means the server encountered an internal error.",
        type: QuestionType.TrueFalse,
        options: [
          { text: "True", correct: false },
          { text: "False", correct: true },
        ],
      },
      {
        text: "Which status code indicates successful resource creation?",
        type: QuestionType.MultipleChoice,
        options: [
          { text: "201 Created", correct: true },
          { text: "200 OK", correct: false },
          { text: "204 No Content", correct: false },
          { text: "202 Accepted", correct: false },
        ],
      },
    ]
  );

  // ─── Purchases and enrollments ───
  // Every individual purchase enrolls its buyer. Team buyers are not enrolled;
  // their seats enroll whoever redeems a coupon.

  function priceFor(course: CourseKey, country: string) {
    const c = courses[course];
    return c.pppEnabled ? calculatePppPrice(c.price, country) : c.price;
  }

  for (const plan of purchasePlans) {
    const at = daysAgo(plan.daysAgo);
    db.insert(schema.purchases)
      .values({
        userId: user(plan.email).id,
        courseId: courses[plan.course].id,
        amountPaid: priceFor(plan.course, plan.country),
        country: plan.country,
        createdAt: at,
      })
      .run();
    db.insert(schema.enrollments)
      .values({
        userId: user(plan.email).id,
        courseId: courses[plan.course].id,
        enrolledAt: at,
      })
      .run();
  }

  // ─── Teams and coupons ───

  for (const team of TEAMS) {
    const at = daysAgo(team.daysAgo);
    const course = courses[team.course];
    const buyer = user(team.buyerEmail);

    const teamRow = db.insert(schema.teams).values({ createdAt: at }).returning().get();
    db.insert(schema.teamMembers)
      .values({ teamId: teamRow.id, userId: buyer.id, role: TeamMemberRole.Admin, createdAt: at })
      .run();

    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: buyer.id,
        courseId: course.id,
        amountPaid: priceFor(team.course, team.country) * team.seats,
        country: team.country,
        createdAt: at,
      })
      .returning()
      .get();

    const prefix = `TEAM-${team.course.toUpperCase()}-${teamRow.id}`;
    for (let seat = 0; seat < team.seats; seat++) {
      const redemption = team.redemptions[seat];
      db.insert(schema.coupons)
        .values({
          teamId: teamRow.id,
          courseId: course.id,
          code: `${prefix}-${String(seat + 1).padStart(2, "0")}`,
          purchaseId: purchase.id,
          redeemedByUserId: redemption ? user(redemption.email).id : null,
          redeemedAt: redemption ? daysAgo(redemption.daysAgo) : null,
          createdAt: at,
        })
        .run();
      if (redemption) {
        db.insert(schema.enrollments)
          .values({
            userId: user(redemption.email).id,
            courseId: course.id,
            enrolledAt: daysAgo(redemption.daysAgo),
          })
          .run();
      }
    }
  }

  // ─── Course Ratings ───
  // Star ratings from enrolled students only. Not everyone rates.
  // TypeScript averages 4.25 (4 ratings), Node.js 4.5 (2); the rest are unrated.

  db.insert(schema.courseRatings)
    .values([
      {
        userId: emma.id,
        courseId: courses.typescript.id,
        rating: 5,
        createdAt: daysAgo(20),
        updatedAt: daysAgo(20),
      },
      {
        userId: james.id,
        courseId: courses.typescript.id,
        rating: 5,
        createdAt: daysAgo(9),
        updatedAt: daysAgo(9),
      },
      {
        userId: olivia.id,
        courseId: courses.typescript.id,
        rating: 4,
        createdAt: daysAgo(18),
        updatedAt: daysAgo(18),
      },
      {
        userId: sophia.id,
        courseId: courses.typescript.id,
        rating: 3,
        createdAt: daysAgo(5),
        updatedAt: daysAgo(5),
      },
      {
        userId: emma.id,
        courseId: courses.node.id,
        rating: 4,
        createdAt: daysAgo(12),
        updatedAt: daysAgo(12),
      },
      {
        userId: liam.id,
        courseId: courses.node.id,
        rating: 5,
        createdAt: daysAgo(8),
        updatedAt: daysAgo(8),
      },
    ])
    .run();


  // ─── Lesson Comments ───
  // Covers every state the Q&A feature can be in, so the instructor queue and
  // the lesson thread both have something real to render: answered threads,
  // questions still waiting (two of them stale enough to flag), a question only
  // another student replied to (still unanswered), an edited comment, and a
  // deleted question kept as a tombstone because it has a reply.
  // Only enrolled students comment.

  function comment(values: typeof schema.comments.$inferInsert) {
    return db.insert(schema.comments).values(values).returning().get();
  }

  // Answered: student asks, Sarah answers, student confirms.
  const c1q1 = comment({
    lessonId: tsLessons[2],
    userId: emma.id,
    body: "I'm getting `tsc: command not found` when I run the compile step. Did I miss an install somewhere?",
    createdAt: daysAgo(30),
  });
  comment({
    lessonId: tsLessons[2],
    userId: sarah.id,
    parentId: c1q1.id,
    body: "That usually means TypeScript is installed locally but not on your PATH. Two options:\n\n```bash\nnpx tsc --version\n```\n\nor install it globally with `npm i -g typescript`. I'd stick with `npx` — it keeps the version pinned to the project.",
    createdAt: daysAgo(29),
  });
  comment({
    lessonId: tsLessons[2],
    userId: emma.id,
    parentId: c1q1.id,
    body: "`npx` did it. Thank you!",
    createdAt: daysAgo(29),
  });

  // Waiting, and stale enough to flag amber in the queue.
  comment({
    lessonId: genericsLesson,
    userId: olivia.id,
    body: "Why does this fail to infer? I expected `T` to come out as `string`.\n\n```typescript\nfunction first<T>(items: T[]): T {\n  return items[0];\n}\n\nconst x = first([]);\n```",
    createdAt: daysAgo(6),
  });

  // Waiting, but posted today — should look calm in the queue.
  comment({
    lessonId: tsLessons[4],
    userId: sophia.id,
    body: "Is there a reason to prefer `interface` over `type` here, or is it purely style?",
    createdAt: daysAgo(1),
  });

  // Another student replied, but no staff has — still counts as unanswered.
  const c1q4 = comment({
    lessonId: tsLessons[3],
    userId: james.id,
    body: "Does strict mode change anything about how this example behaves?",
    createdAt: daysAgo(4),
  });
  comment({
    lessonId: tsLessons[3],
    userId: emma.id,
    parentId: c1q4.id,
    body: "I think it only affects the null checks, but I'd like a second opinion too.",
    createdAt: daysAgo(4),
  });

  // Edited by its author — renders an "(edited)" marker.
  const c1q5 = comment({
    lessonId: tsLessons[0],
    userId: james.id,
    body: "Coming from JavaScript, how much of this will feel familiar? (Edited to add: I've used JSDoc types before.)",
    createdAt: daysAgo(40),
    editedAt: daysAgo(39),
  });
  comment({
    lessonId: tsLessons[0],
    userId: sarah.id,
    parentId: c1q5.id,
    body: "Most of it. If you've written JSDoc types you already understand the mental model — the syntax is just less noisy.",
    createdAt: daysAgo(39),
  });

  // Deleted question that keeps its reply — renders as a tombstone.
  const c1q6 = comment({
    lessonId: tsLessons[1],
    userId: sophia.id,
    body: "Posted this on the wrong lesson, sorry!",
    createdAt: daysAgo(12),
    deletedAt: daysAgo(12),
  });
  comment({
    lessonId: tsLessons[1],
    userId: sarah.id,
    parentId: c1q6.id,
    body: "No problem at all — asked and answered over on the generics lesson.",
    createdAt: daysAgo(12),
  });

  // Course 2: waiting a long time.
  comment({
    lessonId: nodeLessons[2],
    userId: liam.id,
    body: "When would you return a 422 instead of a 400? The distinction still isn't clicking for me.",
    createdAt: daysAgo(9),
  });

  // Course 2: answered by an admin rather than the owning instructor.
  const c2q2 = comment({
    lessonId: nodeLessons[0],
    userId: olivia.id,
    body: "Are the example requests in this lesson hitting a real API, or is it all mocked?",
    createdAt: daysAgo(14),
  });
  comment({
    lessonId: nodeLessons[0],
    userId: admin.id,
    parentId: c2q2.id,
    body: "All mocked — nothing leaves your machine. The repo linked on the lesson has the fixtures.",
    createdAt: daysAgo(13),
  });

  // An instructor's own top-level post never queues up as work for themselves.
  comment({
    lessonId: nodeLessons[1],
    userId: marcus.id,
    body: "Heads up: the status code table was updated this week to include 418. Refresh if you cached the old one.",
    createdAt: daysAgo(7),
  });


  // ─── Lesson Progress ───
  // Each course's enrollees follow a planted funnel: completions decline gently
  // lesson by lesson, then fall off a cliff at the course's DROP_OFF_CLIFFS
  // lesson. Earlier enrollees get further (they have had longer). Each student
  // completes a prefix of the course and has the next lesson in progress.

  /** When each user completed each lesson, keyed `${userId}:${lessonId}`. */
  const completedAt = new Map<string, string>();

  /** Video sessions to replay as watch events once progress is in place. */
  type WatchSession = {
    userId: number;
    lesson: LessonSpec;
    lessonId: number;
    startedAt: number;
    stopAtSeconds: number;
    finished: boolean;
  };
  const watchSessions: WatchSession[] = [];

  for (const key of Object.keys(COURSES) as CourseKey[]) {
    const course = courses[key];
    const ids = lessonIds[key];
    const cliff = CLIFF_LESSONS[key];
    const cliffIndex = cliff ? COURSE_LESSON_TITLES[key].indexOf(cliff) : ids.length;

    const enrollees = db
      .select()
      .from(schema.enrollments)
      .where(eq(schema.enrollments.courseId, course.id))
      .orderBy(schema.enrollments.enrolledAt)
      .all();
    if (enrollees.length === 0) continue;

    // Share of enrollees who complete lesson k.
    const reach = (k: number) =>
      k < cliffIndex ? 1 - 0.02 * k : Math.max(0.38 - 0.015 * (k - cliffIndex), 0.1);
    const completers = ids.map((_, k) => Math.round(reach(k) * enrollees.length));

    enrollees.forEach((enrollment, i) => {
      const done = completers.filter((count) => i < count).length;
      const enrolledDaysAgo = (Date.now() - Date.parse(enrollment.enrolledAt)) / DAY_MS;
      let lastCompletedAt: string | null = null;

      for (let k = 0; k < done; k++) {
        // Spread completions evenly between enrolling and now.
        const at = daysAgo(enrolledDaysAgo * (1 - (k + 1) / (done + 1)));
        db.insert(schema.lessonProgress)
          .values({
            userId: enrollment.userId,
            lessonId: ids[k],
            status: LessonProgressStatus.Completed,
            completedAt: at,
          })
          .run();
        completedAt.set(`${enrollment.userId}:${ids[k]}`, at);
        lastCompletedAt = at;
      }

      const lessons = COURSES[key].modules.flatMap((m) => m.lessons);

      // Watched the last completed lesson through to the end.
      if (lastCompletedAt) {
        const lesson = lessons[done - 1];
        const seconds = lesson.duration * 60;
        watchSessions.push({
          userId: enrollment.userId,
          lesson,
          lessonId: ids[done - 1],
          startedAt: Date.parse(lastCompletedAt) - seconds * 1000,
          stopAtSeconds: seconds,
          finished: true,
        });
      }

      if (done < ids.length) {
        db.insert(schema.lessonProgress)
          .values({
            userId: enrollment.userId,
            lessonId: ids[done],
            status: LessonProgressStatus.InProgress,
          })
          .run();

        // Paused part-way through the next lesson, half a day later.
        const lesson = lessons[done];
        const lastActive = lastCompletedAt
          ? Date.parse(lastCompletedAt)
          : Date.parse(enrollment.enrolledAt);
        const seconds = lesson.duration * 60;
        const stopAtSeconds = Math.round((seconds * (0.2 + 0.5 * ((i % 5) / 5))) / 10) * 10;
        watchSessions.push({
          userId: enrollment.userId,
          lesson,
          lessonId: ids[done],
          startedAt: Math.min(lastActive + DAY_MS / 2, Date.now() - (stopAtSeconds + 60) * 1000),
          stopAtSeconds,
          finished: false,
        });
      } else {
        db.update(schema.enrollments)
          .set({ completedAt: lastCompletedAt })
          .where(eq(schema.enrollments.id, enrollment.id))
          .run();
      }
    });
  }

  // ─── Quiz Attempts ───
  // Everyone who completed a quiz's lesson took the quiz that day. Most pass
  // first time; the rest fail, and most of those retake and pass a day later.

  const quizRandom = createRandom(1717);

  function recordQuizAttempt(
    userId: number,
    quiz: typeof schema.quizzes.$inferSelect,
    optionIds: QuizOptionRef[],
    correctQuestionCount: number,
    attemptedAt: string
  ) {
    const questionIds = [...new Set(optionIds.map((o) => o.questionId))];
    const score = correctQuestionCount / questionIds.length;

    const attempt = db
      .insert(schema.quizAttempts)
      .values({
        userId,
        quizId: quiz.id,
        score,
        passed: score >= quiz.passingScore,
        attemptedAt,
      })
      .returning()
      .get();

    questionIds.forEach((questionId, qi) => {
      const options = optionIds.filter((o) => o.questionId === questionId);
      const answeredCorrectly = qi < correctQuestionCount;
      const selected = options.find((o) => o.correct === answeredCorrectly)!;
      db.insert(schema.quizAnswers)
        .values({ attemptId: attempt.id, questionId, selectedOptionId: selected.optionId })
        .run();
    });
  }

  for (const { quiz, optionIds } of [quizBasics, quizGenerics, quizHttp]) {
    const questionCount = new Set(optionIds.map((o) => o.questionId)).size;
    for (const [key, at] of completedAt) {
      const [userId, lessonId] = key.split(":").map(Number);
      if (lessonId !== quiz.lessonId) continue;
      if (quizRandom() < 0.7) {
        recordQuizAttempt(userId, quiz, optionIds, questionCount, at);
      } else {
        recordQuizAttempt(userId, quiz, optionIds, 1, at);
        if (quizRandom() < 0.7) {
          const retake = new Date(Math.min(Date.parse(at) + DAY_MS, Date.now())).toISOString();
          recordQuizAttempt(userId, quiz, optionIds, questionCount, retake);
        }
      }
    }
  }

  // ─── Video Watch Events ───
  // Replays each session the way youtube-player.tsx reports it: "play", a
  // "progress" heartbeat every 10 seconds of playback, then "ended" or "pause".

  const HEARTBEAT_SECONDS = 10;
  const watchEvents: (typeof schema.videoWatchEvents.$inferInsert)[] = [];

  for (const session of watchSessions) {
    if (!session.lesson.videoUrl) continue;
    const event = (eventType: string, positionSeconds: number) =>
      watchEvents.push({
        userId: session.userId,
        lessonId: session.lessonId,
        eventType,
        positionSeconds,
        createdAt: new Date(session.startedAt + positionSeconds * 1000).toISOString(),
      });

    event("play", 0);
    for (let pos = HEARTBEAT_SECONDS; pos < session.stopAtSeconds; pos += HEARTBEAT_SECONDS) {
      event("progress", pos);
    }
    event(session.finished ? "ended" : "pause", session.stopAtSeconds);
  }

  // Chunked so each insert stays well under SQLite's bound-parameter limit.
  for (let i = 0; i < watchEvents.length; i += 500) {
    db.insert(schema.videoWatchEvents).values(watchEvents.slice(i, i + 500)).run();
  }

  return summarize(db);
}

// ─── Summary ───

export type SeedSummary = {
  rowCounts: Record<string, number>;
  usersByRole: Record<string, number>;
  coupons: { redeemed: number; available: number };
};

/** Counts read back from the database, so the summary can't drift from the data. */
function summarize(db: SeedDb): SeedSummary {
  const tables = db.all<{ name: string }>(sql`
    select name from sqlite_master
    where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'
    order by name
  `);
  const rowCounts = Object.fromEntries(
    tables.map(({ name }) => [
      name,
      db.get<{ n: number }>(sql`select count(*) as n from ${sql.identifier(name)}`)!.n,
    ])
  );
  const usersByRole = Object.fromEntries(
    db
      .all<{ role: string; n: number }>(sql`select role, count(*) as n from users group by role`)
      .map((r) => [r.role, r.n])
  );
  const { redeemed } = db.get<{ redeemed: number }>(
    sql`select count(redeemed_by_user_id) as redeemed from coupons`
  )!;
  return {
    rowCounts,
    usersByRole,
    coupons: { redeemed, available: rowCounts.coupons - redeemed },
  };
}
