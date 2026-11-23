import { Award, Trophy, type LucideIcon } from "lucide-react";
import { BadgeFamily, type EarnedBadge } from "~/lib/badges";
import { cn } from "~/lib/utils";

const FAMILY_STYLE: Record<BadgeFamily, { icon: LucideIcon; className: string }> = {
  [BadgeFamily.Course]: {
    icon: Trophy,
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  },
};

export function BadgeShelf({ badges }: { badges: EarnedBadge[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold">Badges</h2>
      {badges.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <Award className="size-5" />
          Finish a course to earn your first badge.
        </div>
      ) : (
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
                    {new Date(badge.earnedAt).toLocaleDateString()}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
