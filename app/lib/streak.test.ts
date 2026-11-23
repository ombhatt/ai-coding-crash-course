import { describe, it, expect } from "vitest";
import { weeklyStreak } from "./streak";

// 2026-11-16 and 2026-11-23 are Mondays.
describe("weeklyStreak", () => {
  it("counts completions in two consecutive weeks as a two-week streak", () => {
    expect(
      weeklyStreak(
        ["2026-11-18T10:00:00.000Z", "2026-11-24T10:00:00.000Z"],
        "2026-11-24T10:00:00.000Z"
      )
    ).toBe(2);
  });

  it("treats Sunday 23:59:59.999 and Monday 00:00 UTC as different weeks", () => {
    expect(
      weeklyStreak(
        ["2026-11-22T23:59:59.999Z", "2026-11-23T00:00:00.000Z"],
        "2026-11-23T00:00:00.000Z"
      )
    ).toBe(2);
  });

  it("counts several completions in the same week as one week", () => {
    expect(
      weeklyStreak(
        [
          "2026-11-23T08:00:00.000Z",
          "2026-11-25T08:00:00.000Z",
          "2026-11-29T08:00:00.000Z",
        ],
        "2026-11-29T08:00:00.000Z"
      )
    ).toBe(1);
  });

  it("restarts the streak after a week with no completions", () => {
    expect(
      weeklyStreak(
        [
          "2026-11-02T08:00:00.000Z", // week 1
          "2026-11-09T08:00:00.000Z", // week 2
          // week 3 missed
          "2026-11-23T08:00:00.000Z", // week 4
        ],
        "2026-11-23T08:00:00.000Z"
      )
    ).toBe(1);
  });

  it("continues a streak across the new year", () => {
    expect(
      weeklyStreak(
        ["2026-12-31T08:00:00.000Z", "2027-01-07T08:00:00.000Z"],
        "2027-01-07T08:00:00.000Z"
      )
    ).toBe(2);
  });
});
