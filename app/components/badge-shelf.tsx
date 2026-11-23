import { Award, Flame, Layers, Trophy, type LucideIcon } from "lucide-react";
import {
  BadgeFamily,
  type BadgeProgress,
  type EarnedBadge,
} from "~/lib/badges";
import { cn } from "~/lib/utils";

const FAMILY_STYLE: Record<BadgeFamily, { icon: LucideIcon; className: string }> = {
  [BadgeFamily.Course]: {
    icon: Trophy,
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  },
  [BadgeFamily.Module]: {
    icon: Layers,
    className: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400",
  },
  [BadgeFamily.Streak]: {
    icon: Flame,
    className: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
  },
};

// A fixed locale and time zone, so the server and browser render the same
// text (no hydration mismatch). UTC also matches the UTC weeks used for streaks.
function formatEarnedDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function progressLabel({ family, current, target }: BadgeProgress) {
  switch (family) {
    case BadgeFamily.Course:
      return `${current} / ${target} courses`;
    case BadgeFamily.Module:
      return `${current} / ${target} modules`;
    case BadgeFamily.Streak:
      return `Current streak: ${current} ${current === 1 ? "week" : "weeks"} · next: ${target}`;
  }
}

export function BadgeShelf({
  badges,
  progress,
}: {
  badges: EarnedBadge[];
  progress: BadgeProgress[];
}) {
  // Only staff have neither: students always have a next level or earned
  // badges. Staff cannot earn badges, so they get no shelf at all.
  if (badges.length === 0 && progress.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold">Badges</h2>
      {badges.length === 0 && (
        <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Award className="size-4" />
          Finish a module to earn your first badge.
        </p>
      )}
      <ul className="flex flex-wrap gap-3">
        {badges.map((badge) => {
          const { icon: Icon, className } = FAMILY_STYLE[badge.family];
          return (
            <li
              key={`${badge.key}-${badge.courseId ?? "global"}`}
              className="flex items-center gap-3 rounded-lg border bg-card p-3 pr-4"
              title={badge.description}
            >
              <span
                className={cn(
                  "flex size-10 items-center justify-center rounded-full",
                  className
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-medium">{badge.name}</span>
                <span className="text-xs text-muted-foreground">
                  {badge.courseTitle ?? badge.description} ·{" "}
                  {formatEarnedDate(badge.earnedAt)}
                </span>
              </span>
            </li>
          );
        })}
        {progress.map((next) => {
          const { icon: Icon } = FAMILY_STYLE[next.family];
          const percent = Math.min(100, (next.current / next.target) * 100);
          return (
            <li
              key={next.key}
              className="flex items-center gap-3 rounded-lg border border-dashed p-3 pr-4 text-muted-foreground"
              title={`Locked: ${next.description}`}
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-muted">
                <Icon className="size-5 opacity-60" />
              </span>
              <span className="flex min-w-40 flex-col gap-1">
                <span className="text-sm font-medium">{next.name}</span>
                <span className="text-xs">{progressLabel(next)}</span>
                <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-muted-foreground/50"
                    style={{ width: `${percent}%` }}
                  />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
