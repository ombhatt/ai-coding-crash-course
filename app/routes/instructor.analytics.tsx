import { Link, isRouteErrorResponse, useSearchParams } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/instructor.analytics";
import { requireInstructorOrAdmin } from "~/lib/access.server";
import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  TOP_BUYER_LIMIT,
} from "~/lib/analytics";
import {
  type RevenueSeries,
  getAnalyticsCourses,
  getAudienceSummary,
  getCourseCompletion,
  getCourseDropOff,
  getCourseRatings,
  getQuizPassRates,
  getRevenueByCountry,
  getRevenueSeries,
  getRevenueSummary,
  getTopBuyers,
  getUnredeemedSeatCount,
  hasPublishedCourses,
} from "~/services/analyticsService";
import { countUnansweredQuestions } from "~/services/commentService";
import { getUsersByRole } from "~/services/userService";
import { UserRole } from "~/db/schema";
import { StarRating } from "~/components/star-rating";
import { PLATFORM_FEE_PERCENT } from "~/lib/fees";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  AlertTriangle,
  BarChart3,
  BookPlus,
  ClipboardCheck,
  Globe,
  GraduationCap,
  Users,
} from "lucide-react";
import { Label } from "~/components/ui/label";
import { CourseStatus } from "~/db/schema";
import { cn, formatCents } from "~/lib/utils";

// ─── Instructor Analytics ───
// "How is my teaching business doing?" on one page. Tab and range live in the
// URL so a view can be bookmarked or shared; the loader reads them, the
// analytics service does all the arithmetic, and this module only renders.
//
// Admins also pick whose numbers to see — one instructor, or every instructor
// at once — via the `instructor` param. Instructors always see their own; the
// loader ignores the param for them.

const TABS = ["overview", "course"] as const;
const ALL_INSTRUCTORS = "all";

const searchSchema = z.object({
  tab: z.enum(TABS).catch("overview"),
  range: z.enum(ANALYTICS_RANGES).catch("30d"),
  /** Admins only: an instructor's id, or "all" for the whole platform. */
  instructor: z
    .union([z.literal(ALL_INSTRUCTORS), z.coerce.number().int().positive()])
    .catch(ALL_INSTRUCTORS),
  /** The Course detail tab's course; falls back to the default when invalid. */
  course: z.coerce.number().int().optional().catch(undefined),
});

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
};

export function meta() {
  return [{ title: "Analytics — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { userId, isAdmin } = await requireInstructorOrAdmin(request);
  const search = searchSchema.parse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  const { tab, range } = search;

  // Whose numbers to show: always your own as an instructor. An admin gets the
  // instructor they picked, or everyone (null) — also when the id in the URL
  // isn't an instructor.
  const instructors = isAdmin
    ? getUsersByRole(UserRole.Instructor)
        .map(({ id, name }) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : null;
  const picked = instructors?.find((i) => i.id === search.instructor) ?? null;
  const instructorId = isAdmin ? (picked?.id ?? null) : userId;
  const view = {
    tab,
    range,
    /** The admin picker's options; null for instructors, who get no picker. */
    instructors,
    /** The picked instructor, or null for all instructors (or yourself). */
    picked,
  };

  if (!hasPublishedCourses(instructorId)) {
    return { ...view, hasPublishedCourses: false as const };
  }

  // An id that isn't among the viewed instructor's courses falls back to the
  // default, so a hand-edited URL can't reach another instructor's course —
  // and switching instructors never leaves a stale course selected.
  const courses = getAnalyticsCourses(instructorId);
  const selectedCourse =
    courses.find((c) => c.id === search.course) ?? courses[0];

  return {
    ...view,
    hasPublishedCourses: true as const,
    revenue: getRevenueSummary(instructorId, range),
    revenueSeries: getRevenueSeries(instructorId, range),
    audience: getAudienceSummary(instructorId, range),
    unredeemedSeats: getUnredeemedSeatCount(instructorId),
    topBuyers: getTopBuyers(instructorId, range),
    unansweredQuestions: countUnansweredQuestions(instructorId),
    ratings: getCourseRatings(instructorId),
    courses,
    selectedCourseId: selectedCourse.id,
    completion: getCourseCompletion(instructorId, selectedCourse.id),
    dropOff: getCourseDropOff(instructorId, selectedCourse.id),
    quizPassRates: getQuizPassRates(instructorId, selectedCourse.id),
    countryRevenue: getRevenueByCountry(instructorId, selectedCourse.id, range),
  };
}

type ViewData = Pick<
  Awaited<ReturnType<typeof loader>>,
  "instructors" | "picked"
>;

function PageHeader({ instructors, picked }: ViewData) {
  let subtitle = "How your courses are selling, across everything you teach.";
  if (instructors) {
    subtitle = picked
      ? `How ${picked.name}'s courses are selling.`
      : "How courses are selling across every instructor on the platform.";
  }

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="mt-1 text-muted-foreground">{subtitle}</p>
      </div>
      {instructors && (
        <InstructorPicker instructors={instructors} picked={picked} />
      )}
    </div>
  );
}

/** Admins only. Writes the choice to the URL, which the loader reads. */
function InstructorPicker({
  instructors,
  picked,
}: {
  instructors: NonNullable<ViewData["instructors"]>;
  picked: ViewData["picked"];
}) {
  const [, setSearchParams] = useSearchParams();

  return (
    <Select
      value={picked ? String(picked.id) : ALL_INSTRUCTORS}
      onValueChange={(next) =>
        setSearchParams(
          (params) => {
            params.set("instructor", next);
            return params;
          },
          { preventScrollReset: true }
        )
      }
    >
      <SelectTrigger className="w-56" aria-label="Instructor">
        {/* Explicit, so the server render shows the choice before hydration. */}
        <SelectValue>{picked ? picked.name : "All instructors"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_INSTRUCTORS}>All instructors</SelectItem>
        {instructors.map((instructor) => (
          <SelectItem key={instructor.id} value={String(instructor.id)}>
            {instructor.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RangeSelector({ range }: { range: AnalyticsRange }) {
  // Keeps the other params (tab, instructor) so a range change is the only
  // thing that moves.
  const [searchParams] = useSearchParams();
  const linkTo = (option: AnalyticsRange) => {
    const params = new URLSearchParams(searchParams);
    params.set("range", option);
    return `?${params}`;
  };

  return (
    <nav
      aria-label="Time range"
      className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground"
    >
      {ANALYTICS_RANGES.map((option) => (
        <Link
          key={option}
          to={linkTo(option)}
          preventScrollReset
          aria-current={option === range ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
            option === range
              ? "bg-background text-foreground shadow-sm"
              : "hover:text-foreground"
          )}
        >
          {RANGE_LABELS[option]}
        </Link>
      ))}
    </nav>
  );
}

function StatCard({
  label,
  value,
  hint,
  emphasis = false,
  children,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  emphasis?: boolean;
  /** Extra content under the hint, such as a call to action. */
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div
          className={cn(
            "mt-2 text-3xl font-bold tabular-nums",
            !emphasis && "text-muted-foreground"
          )}
        >
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        {children}
      </CardContent>
    </Card>
  );
}

function SectionHeading({
  id,
  title,
  scope,
}: {
  id: string;
  title: string;
  /** What the numbers cover: the selected range, or "all time". */
  scope: string;
}) {
  return (
    <h2 id={id} className="mb-3 text-lg font-semibold">
      {title}{" "}
      <span className="font-normal text-muted-foreground">· {scope}</span>
    </h2>
  );
}

type OverviewData = Extract<
  Awaited<ReturnType<typeof loader>>,
  { hasPublishedCourses: true }
>;

function AudiencePanel({
  audience,
  unredeemedSeats,
}: Pick<OverviewData, "audience" | "unredeemedSeats">) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Buyers"
        value={audience.buyers}
        hint={
          audience.buyers === 0
            ? "Nobody bought a course in this period yet."
            : "People who paid, including team buyers."
        }
        emphasis
      />
      <StatCard
        label="Students"
        value={audience.students}
        hint={
          audience.students === 0
            ? "Nobody enrolled in this period yet."
            : "People who enrolled, including seat redeemers."
        }
        emphasis
      />
      <StatCard
        label="Revenue per student"
        value={
          audience.students === 0
            ? "—"
            : formatCents(audience.revenuePerStudent)
        }
        hint={
          audience.students === 0
            ? "Shown once students enroll."
            : "Team seats count at their share of the team price."
        }
      />
      <StatCard
        label="Unredeemed seats · all time"
        value={unredeemedSeats}
        hint={
          unredeemedSeats === 0
            ? "No team seats are waiting to be claimed."
            : "Team seats paid for that nobody has claimed."
        }
      />
    </div>
  );
}

function TopBuyersPanel({ buyers }: { buyers: OverviewData["topBuyers"] }) {
  if (buyers.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Users className="mx-auto mb-3 size-10 text-muted-foreground" />
          <p className="font-medium">No buyers in this period</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your biggest customers will be ranked here once people buy.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="w-10 px-4 py-3 text-left font-medium">#</th>
            <th className="px-4 py-3 text-left font-medium">Buyer</th>
            <th className="px-4 py-3 text-left font-medium">Type</th>
            <th className="px-4 py-3 text-right font-medium">Spent</th>
          </tr>
        </thead>
        <tbody>
          {buyers.map((buyer, index) => (
            <tr key={buyer.userId} className="border-b last:border-0">
              <td className="px-4 py-3 text-muted-foreground tabular-nums">
                {index + 1}
              </td>
              <td className="px-4 py-3">
                <div className="font-medium">{buyer.name}</div>
                <div className="text-xs text-muted-foreground">
                  {buyer.email}
                  {!buyer.enrolled && " · not enrolled"}
                </div>
              </td>
              <td className="px-4 py-3">
                {buyer.seats > 0 ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      Team · {buyer.seats}{" "}
                      {buyer.seats === 1 ? "seat" : "seats"}
                    </span>
                    {buyer.unredeemedSeats > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {buyer.unredeemedSeats} unredeemed
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Individual
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">
                {formatCents(buyer.totalSpent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuestionsCard({ count }: { count: number }) {
  return (
    <StatCard
      label="Unanswered questions"
      value={count}
      hint={
        count === 0
          ? "No student is waiting on you. Nice."
          : "Students waiting on a reply from you."
      }
      emphasis
    >
      {count > 0 && (
        <Link
          to="/instructor/questions"
          className="mt-3 inline-block text-sm font-medium underline-offset-4 hover:underline"
        >
          Answer questions →
        </Link>
      )}
    </StatCard>
  );
}

function RatingsCard({ ratings }: { ratings: OverviewData["ratings"] }) {
  const anyRated = ratings.some((course) => course.count > 0);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="text-sm font-medium text-muted-foreground">
          Course ratings
        </div>
        {!anyRated ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No ratings yet. They&apos;ll appear here as students rate your
            courses.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {ratings.map((course) => (
              <li
                key={course.courseId}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span className="truncate">{course.title}</span>
                <StarRating
                  average={course.average}
                  count={course.count}
                  className="shrink-0"
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const revenueChartConfig = {
  gross: { label: "Gross revenue", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Axis and tooltip labels for a bucket's first day (`YYYY-MM-DD`, UTC). */
function formatBucket(
  start: string,
  granularity: RevenueSeries["granularity"],
  long = false
) {
  const date = new Date(`${start}T00:00:00.000Z`);
  if (granularity === "month") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return granularity === "week" && long ? `Week of ${day}` : day;
}

function RevenueChart({ series }: { series: RevenueSeries }) {
  if (series.points.length === 0) {
    return (
      <Card>
        <CardContent className="flex h-64 flex-col items-center justify-center text-center">
          <BarChart3 className="mb-3 size-10 text-muted-foreground" />
          <p className="font-medium">No sales in this period</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Revenue will be charted here as purchases come in. Try a longer time
            range.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <ChartContainer
          config={revenueChartConfig}
          className="aspect-auto h-64 w-full"
        >
          <BarChart data={series.points} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="start"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(start: string) =>
                formatBucket(start, series.granularity)
              }
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(cents: number) =>
                `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
              }
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const start = payload[0]?.payload.start;
                    return start
                      ? formatBucket(start, series.granularity, true)
                      : null;
                  }}
                  formatter={(value) => (
                    <div className="flex w-full justify-between gap-4">
                      <span className="text-muted-foreground">Gross</span>
                      <span className="font-mono font-medium tabular-nums">
                        {formatCents(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Bar dataKey="gross" fill="var(--color-gross)" radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function CoursePicker({
  courses,
  value,
  onChange,
}: {
  courses: OverviewData["courses"];
  value: string;
  onChange: (courseId: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Label htmlFor="analytics-course">Course</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="analytics-course" className="w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {courses.map((course) => (
            <SelectItem key={course.id} value={String(course.id)}>
              {course.title}
              {course.status !== CourseStatus.Published &&
                ` (${course.status})`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CompletionPanel({
  completion,
}: {
  completion: OverviewData["completion"];
}) {
  if (!completion || completion.enrollees === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <GraduationCap className="mx-auto mb-3 size-10 text-muted-foreground" />
          <p className="font-medium">No students yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Progress and completions will show here once students enroll in this
            course.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { enrollees, averageProgress, finished } = completion;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <StatCard
        label="Average progress"
        value={`${averageProgress}%`}
        hint={`Share of lessons completed, averaged over all ${enrollees} ${
          enrollees === 1 ? "student" : "students"
        }.`}
        emphasis
      >
        <div className="mt-3 h-1.5 rounded-full bg-muted">
          <div
            className="h-1.5 rounded-full bg-primary"
            style={{ width: `${averageProgress}%` }}
          />
        </div>
      </StatCard>
      <StatCard
        label="Finished"
        value={finished}
        hint={
          finished === 0
            ? "Nobody has finished this course yet."
            : `Students who reached the end of the course, out of ${enrollees} enrolled.`
        }
        emphasis
      />
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <GraduationCap className="mx-auto mb-3 size-10 text-muted-foreground" />
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

/**
 * One bar per lesson, grouped by module: how many enrollees got at least that
 * far. The number beside each bar is how many stopped there; the biggest is
 * highlighted, since that's the lesson to look at first.
 */
function DropOffPanel({ dropOff }: { dropOff: OverviewData["dropOff"] }) {
  if (!dropOff || dropOff.enrollees === 0) {
    return (
      <EmptyCard
        title="No students yet"
        body="Once students enroll, you'll see how far through the course they get."
      />
    );
  }
  if (dropOff.modules.length === 0) {
    return (
      <EmptyCard
        title="No lessons yet"
        body="Add lessons to this course to see where students stop."
      />
    );
  }

  const { enrollees, neverStarted, modules } = dropOff;
  const biggestDrop = Math.max(
    ...modules.flatMap((m) => m.lessons.map((l) => l.drop))
  );
  const percent = (count: number) => (100 * count) / enrollees;

  return (
    <Card>
      <CardContent className="p-6">
        <p className="mb-5 text-sm text-muted-foreground">
          Each bar counts the {enrollees}{" "}
          {enrollees === 1 ? "student" : "students"} enrolled who reached at
          least that lesson. The number beside it is how many stopped there.
          {neverStarted > 0 && ` ${neverStarted} never started a lesson.`}
        </p>
        <div className="space-y-6">
          {modules.map((module) => (
            <div key={module.id}>
              <div className="mb-2 flex items-baseline justify-between gap-3 border-b pb-1">
                <h3 className="font-medium">{module.title}</h3>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {module.reached} reached · {module.drop} stopped here
                </span>
              </div>
              <ol className="space-y-1.5">
                {module.lessons.map((lesson) => {
                  const isBiggest =
                    biggestDrop > 0 && lesson.drop === biggestDrop;
                  return (
                    <li
                      key={lesson.id}
                      className="grid grid-cols-[minmax(0,14rem)_1fr_2.5rem_3.5rem] items-center gap-3 text-sm"
                    >
                      <span className="truncate" title={lesson.title}>
                        {lesson.title}
                      </span>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${percent(lesson.reached)}%` }}
                        />
                      </div>
                      <span className="text-right tabular-nums">
                        {lesson.reached}
                      </span>
                      <span
                        className={cn(
                          "text-right tabular-nums",
                          isBiggest
                            ? "font-semibold text-destructive"
                            : "text-muted-foreground"
                        )}
                        title={
                          isBiggest
                            ? "The most students stopped here"
                            : undefined
                        }
                      >
                        {lesson.drop > 0 ? `−${lesson.drop}` : "–"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function NoPublishedCourses({ instructors, picked }: ViewData) {
  if (instructors) {
    // An admin looking at someone else's (or nobody's) courses — there's
    // nothing for them to publish here.
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <BookPlus className="mx-auto mb-4 size-12 text-muted-foreground" />
          <p className="font-medium">No published courses</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {picked
              ? `${picked.name} hasn't published a course yet.`
              : "No instructor has published a course yet."}{" "}
            Analytics start once a course is live.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-12 text-center">
        <BookPlus className="mx-auto mb-4 size-12 text-muted-foreground" />
        <p className="font-medium">Publish your first course</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Analytics start once you have a published course. Sales, students, and
          progress will show up here as soon as people find it.
        </p>
        <Link to="/instructor/new" className="mt-6 inline-block">
          <Button>Create a course</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const { tab, range, instructors, picked } = loaderData;
  const [, setSearchParams] = useSearchParams();

  if (!loaderData.hasPublishedCourses) {
    return (
      <div className="mx-auto max-w-5xl p-6 lg:p-8">
        <PageHeader instructors={instructors} picked={picked} />
        <NoPublishedCourses instructors={instructors} picked={picked} />
      </div>
    );
  }

  const {
    revenue,
    revenueSeries,
    audience,
    unredeemedSeats,
    topBuyers,
    unansweredQuestions,
    ratings,
    courses,
    selectedCourseId,
    completion,
    dropOff,
    quizPassRates,
    countryRevenue,
  } = loaderData;
  const scope = RANGE_LABELS[range].toLowerCase();
  const course = String(selectedCourseId);

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <PageHeader instructors={instructors} picked={picked} />

      <Tabs
        value={tab}
        onValueChange={(next) =>
          setSearchParams(
            (params) => {
              params.set("tab", next);
              return params;
            },
            { preventScrollReset: true }
          )
        }
        className="gap-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="course">Course detail</TabsTrigger>
          </TabsList>
          <RangeSelector range={range} />
        </div>

        <TabsContent value="overview">
          <section aria-labelledby="revenue-heading">
            <SectionHeading
              id="revenue-heading"
              title="Revenue"
              scope={scope}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                label="Gross revenue"
                value={formatCents(revenue.gross)}
                hint={
                  revenue.gross === 0
                    ? "No sales in this period yet."
                    : "Everything buyers paid for your courses."
                }
              />
              <StatCard
                label={`Platform fee (${PLATFORM_FEE_PERCENT}%)`}
                value={formatCents(revenue.fee)}
                hint={
                  revenue.gross === 0
                    ? "Nothing to take a cut of yet."
                    : "The platform's cut of gross revenue."
                }
              />
              <StatCard
                label="Net earnings"
                value={formatCents(revenue.net)}
                hint={
                  revenue.gross === 0
                    ? "Earnings appear here once you make a sale."
                    : "Gross minus the platform fee. Not a payout."
                }
                emphasis
              />
            </div>
          </section>

          <section aria-labelledby="revenue-over-time-heading" className="mt-8">
            <SectionHeading
              id="revenue-over-time-heading"
              title="Revenue over time"
              scope={scope}
            />
            <RevenueChart series={revenueSeries} />
          </section>

          <section aria-labelledby="audience-heading" className="mt-8">
            <SectionHeading
              id="audience-heading"
              title="Buyers & students"
              scope={scope}
            />
            <AudiencePanel
              audience={audience}
              unredeemedSeats={unredeemedSeats}
            />
          </section>

          <section aria-labelledby="top-buyers-heading" className="mt-8">
            <SectionHeading
              id="top-buyers-heading"
              title={`Top ${TOP_BUYER_LIMIT} buyers`}
              scope={scope}
            />
            <TopBuyersPanel buyers={topBuyers} />
          </section>

          <section aria-labelledby="attention-heading" className="mt-8">
            <SectionHeading
              id="attention-heading"
              title="Needs your attention"
              scope="all time"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <QuestionsCard count={unansweredQuestions} />
              <RatingsCard ratings={ratings} />
            </div>
          </section>
        </TabsContent>

        <TabsContent value="course">
          <CoursePicker
            courses={courses}
            value={course}
            onChange={(next) =>
              setSearchParams(
                (params) => {
                  params.set("course", next);
                  return params;
                },
                { preventScrollReset: true }
              )
            }
          />

          <section aria-labelledby="completion-heading" className="mt-6">
            <SectionHeading
              id="completion-heading"
              title="Completion"
              scope="all time"
            />
            <CompletionPanel completion={completion} />
          </section>

          <section aria-labelledby="drop-off-heading" className="mt-8">
            <SectionHeading
              id="drop-off-heading"
              title="Drop-off"
              scope="all time"
            />
            <DropOffPanel dropOff={dropOff} />
          </section>

          <section aria-labelledby="quiz-pass-rates-heading" className="mt-8">
            <SectionHeading
              id="quiz-pass-rates-heading"
              title="Quiz pass rates"
              scope="all time"
            />
            <QuizPassRatesPanel quizzes={quizPassRates} />
          </section>

          <section aria-labelledby="country-revenue-heading" className="mt-8">
            <SectionHeading
              id="country-revenue-heading"
              title="Revenue by country"
              scope={scope}
            />
            <CountryRevenuePanel revenue={countryRevenue} />
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function QuizPassRatesPanel({
  quizzes,
}: {
  quizzes: OverviewData["quizPassRates"];
}) {
  if (!quizzes || quizzes.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <ClipboardCheck className="mx-auto mb-3 size-10 text-muted-foreground" />
          <p className="font-medium">No quizzes in this course</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a quiz to a lesson to see how students do on it.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Quiz</th>
            <th className="px-4 py-3 text-right font-medium">Students</th>
            <th className="px-4 py-3 text-right font-medium">
              Passed first try
            </th>
            <th className="px-4 py-3 text-right font-medium">Passed by now</th>
          </tr>
        </thead>
        <tbody>
          {quizzes.map((quiz) => (
            <tr key={quiz.quizId} className="border-b last:border-0">
              <td className="px-4 py-3">
                <div className="font-medium">{quiz.title}</div>
                <div className="text-xs text-muted-foreground">
                  {quiz.lessonTitle}
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {quiz.students}
              </td>
              {quiz.students === 0 ? (
                <td
                  colSpan={2}
                  className="px-4 py-3 text-right text-xs text-muted-foreground"
                >
                  No attempts yet
                </td>
              ) : (
                <>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {quiz.firstAttemptPassRate}%
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {quiz.passRate}%
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountryRevenuePanel({
  revenue,
}: {
  revenue: OverviewData["countryRevenue"];
}) {
  if (!revenue || revenue.countries.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Globe className="mx-auto mb-3 size-10 text-muted-foreground" />
          <p className="font-medium">No sales in this period</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Where this course's buyers are will show here once it sells.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Gross revenue"
          value={formatCents(revenue.gross)}
          hint="Everything buyers paid for this course."
        />
        <StatCard
          label="PPP-discounted"
          value={formatCents(revenue.pppDiscountedGross)}
          hint={
            revenue.pppDiscountedGross === 0
              ? "No sales at a purchasing-power discount."
              : "From buyers in regions priced at a purchasing-power discount."
          }
          emphasis
        />
        <StatCard
          label="Full price"
          value={formatCents(revenue.fullPriceGross)}
          hint="From buyers who paid the list price."
          emphasis
        />
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Country</th>
              <th className="px-4 py-3 text-left font-medium">Pricing</th>
              <th className="px-4 py-3 text-right font-medium">Purchases</th>
              <th className="px-4 py-3 text-right font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {revenue.countries.map((row) => (
              <tr
                key={row.country ?? "unknown"}
                className="border-b last:border-0"
              >
                <td className="px-4 py-3 font-medium">{row.name}</td>
                <td className="px-4 py-3">
                  {row.pppDiscountPercent > 0 ? (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      PPP · {row.pppDiscountPercent}% off
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Full price
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.purchases}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {formatCents(row.gross)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Skeleton className="mb-2 h-9 w-40" />
      <Skeleton className="mb-6 h-4 w-96" />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-9 w-80" />
      </div>
      <Skeleton className="mb-3 h-6 w-48" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
      <Skeleton className="mb-3 mt-8 h-6 w-40" />
      <Skeleton className="h-[306px] w-full" />
      <Skeleton className="mb-3 mt-8 h-6 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
      <Skeleton className="mb-3 mt-8 h-6 w-48" />
      <Skeleton className="h-96 w-full" />
      <Skeleton className="mb-3 mt-8 h-6 w-64" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Not allowed";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have access to this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go home</Button>
        </Link>
      </div>
    </div>
  );
}
