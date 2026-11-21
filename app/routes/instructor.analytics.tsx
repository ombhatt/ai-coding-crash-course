import { Link, isRouteErrorResponse, useSearchParams } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/instructor.analytics";
import { requireInstructorOrAdmin } from "~/lib/access.server";
import { ANALYTICS_RANGES, type AnalyticsRange } from "~/lib/analytics";
import {
  type RevenueSeries,
  getRevenueSeries,
  getRevenueSummary,
  hasPublishedCourses,
} from "~/services/analyticsService";
import { PLATFORM_FEE_PERCENT } from "~/lib/fees";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { AlertTriangle, BarChart3, BookPlus } from "lucide-react";
import { cn, formatCents } from "~/lib/utils";

// ─── Instructor Analytics ───
// "How is my teaching business doing?" on one page. Tab and range live in the
// URL so a view can be bookmarked or shared; the loader reads them, the
// analytics service does all the arithmetic, and this module only renders.

const TABS = ["overview", "course"] as const;
type AnalyticsTab = (typeof TABS)[number];

const searchSchema = z.object({
  tab: z.enum(TABS).catch("overview"),
  range: z.enum(ANALYTICS_RANGES).catch("30d"),
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
  const { userId } = await requireInstructorOrAdmin(request);
  const { tab, range } = searchSchema.parse(
    Object.fromEntries(new URL(request.url).searchParams)
  );

  if (!hasPublishedCourses(userId)) {
    return { tab, range, hasPublishedCourses: false as const };
  }

  return {
    tab,
    range,
    hasPublishedCourses: true as const,
    revenue: getRevenueSummary(userId, range),
    revenueSeries: getRevenueSeries(userId, range),
  };
}

function PageHeader() {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-bold">Analytics</h1>
      <p className="mt-1 text-muted-foreground">
        How your courses are selling, across everything you teach.
      </p>
    </div>
  );
}

function RangeSelector({
  range,
  tab,
}: {
  range: AnalyticsRange;
  tab: AnalyticsTab;
}) {
  return (
    <nav
      aria-label="Time range"
      className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground"
    >
      {ANALYTICS_RANGES.map((option) => (
        <Link
          key={option}
          to={`?tab=${tab}&range=${option}`}
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

function RevenueFigure({
  label,
  cents,
  hint,
  emphasis = false,
}: {
  label: string;
  cents: number;
  hint: string;
  emphasis?: boolean;
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
          {formatCents(cents)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
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

function NoPublishedCourses() {
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
  const { tab, range } = loaderData;
  const [, setSearchParams] = useSearchParams();

  if (!loaderData.hasPublishedCourses) {
    return (
      <div className="mx-auto max-w-5xl p-6 lg:p-8">
        <PageHeader />
        <NoPublishedCourses />
      </div>
    );
  }

  const { revenue, revenueSeries } = loaderData;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <PageHeader />

      <Tabs
        value={tab}
        onValueChange={(next) =>
          setSearchParams({ tab: next, range }, { preventScrollReset: true })
        }
        className="gap-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="course">Course detail</TabsTrigger>
          </TabsList>
          <RangeSelector range={range} tab={tab} />
        </div>

        <TabsContent value="overview">
          <section aria-labelledby="revenue-heading">
            <h2 id="revenue-heading" className="mb-3 text-lg font-semibold">
              Revenue · {RANGE_LABELS[range].toLowerCase()}
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <RevenueFigure
                label="Gross revenue"
                cents={revenue.gross}
                hint="Everything buyers paid for your courses."
              />
              <RevenueFigure
                label={`Platform fee (${PLATFORM_FEE_PERCENT}%)`}
                cents={revenue.fee}
                hint="The platform's cut of gross revenue."
              />
              <RevenueFigure
                label="Net earnings"
                cents={revenue.net}
                hint="Gross minus the platform fee. Not a payout."
                emphasis
              />
            </div>
          </section>

          <section aria-labelledby="revenue-over-time-heading" className="mt-8">
            <h2
              id="revenue-over-time-heading"
              className="mb-3 text-lg font-semibold"
            >
              Revenue over time
            </h2>
            <RevenueChart series={revenueSeries} />
          </section>
        </TabsContent>

        <TabsContent value="course">
          <Card>
            <CardContent className="py-12 text-center">
              <BarChart3 className="mx-auto mb-4 size-12 text-muted-foreground" />
              <p className="font-medium">Course detail</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Per-course progress and drop-off will appear here.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
