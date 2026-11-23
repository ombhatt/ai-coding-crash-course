const DAY_MS = 24 * 60 * 60 * 1000;
// 1970-01-01 was a Thursday; the first UTC Monday was day 4.
const FIRST_MONDAY_DAY = 4;

// Index of the Monday-to-Sunday UTC week containing `iso`.
function utcWeekIndex(iso: string): number {
  const day = Math.floor(new Date(iso).getTime() / DAY_MS);
  return Math.floor((day - FIRST_MONDAY_DAY) / 7);
}

/**
 * The number of consecutive UTC Monday–Sunday weeks, ending with the week
 * containing `endAt`, that have at least one completion. 0 if that week has
 * none. Completions after `endAt`'s week are ignored.
 */
export function weeklyStreak(completedAts: string[], endAt: string): number {
  const weeks = new Set(completedAts.map(utcWeekIndex));

  let streak = 0;
  for (let week = utcWeekIndex(endAt); weeks.has(week); week--) {
    streak++;
  }
  return streak;
}
