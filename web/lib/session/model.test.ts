import { describe, expect, it } from "vitest";

import { bucketRounds, parseDrillDuration, weeklyStats } from "./model";
import type { StrikeLogItem, Summary } from "./model";

const DAY = 86_400_000;

function summary(at: number, strikes = 10, durationMs = 300_000): Summary {
  return {
    duration_ms: durationMs,
    strikes_left: Math.floor(strikes / 2),
    strikes_right: Math.ceil(strikes / 2),
    avg_peak_speed: null,
    avg_peak_speed_left: null,
    avg_peak_speed_right: null,
    max_peak_speed: null,
    avg_guard_recovery_ms: null,
    strikes_per_min: null,
    guard_up_frac: null,
    bounce_cadence_hz: null,
    rhythm_predictability: null,
    steps: 0,
    avg_stance_width_m: null,
    stance_oob_frac: null,
    at,
  };
}

// Noon anchor: day arithmetic in tests must not straddle midnight.
const NOON = new Date(2026, 6, 15, 12, 0, 0).getTime();

describe("weeklyStats", () => {
  it("rolls up only the last 7 days", () => {
    const h = [summary(NOON - DAY, 20), summary(NOON - 8 * DAY, 99)];
    const w = weeklyStats(h, NOON);
    expect(w.sessions7d).toBe(1);
    expect(w.strikes7d).toBe(20);
    expect(w.minutes7d).toBe(5);
  });

  it("counts a streak of consecutive days", () => {
    const h = [summary(NOON), summary(NOON - DAY), summary(NOON - 2 * DAY)];
    expect(weeklyStats(h, NOON).streakDays).toBe(3);
  });

  it("keeps the streak alive when today has no session yet", () => {
    const h = [summary(NOON - DAY), summary(NOON - 2 * DAY)];
    expect(weeklyStats(h, NOON).streakDays).toBe(2);
  });

  it("breaks the streak on a missed day", () => {
    const h = [summary(NOON), summary(NOON - 2 * DAY)];
    expect(weeklyStats(h, NOON).streakDays).toBe(1);
  });

  it("multiple sessions in one day count once toward the streak", () => {
    const h = [summary(NOON), summary(NOON - 3_600_000), summary(NOON - DAY)];
    expect(weeklyStats(h, NOON).streakDays).toBe(2);
  });
});

function strike(tMs: number, speed = 7, recovery: number | null = 300): StrikeLogItem {
  return { t_ms: tMs, hand: "left", peak_speed: speed, guard_recovery_ms: recovery };
}

describe("bucketRounds", () => {
  it("buckets work-phase strikes and excludes rest", () => {
    const log = [
      strike(10_000), // R1 work
      strike(185_000), // R1 rest (3:00 work + 1:00 rest cycle)
      strike(245_000), // R2 work (cycle starts at 240s)
    ];
    const rounds = bucketRounds(log, 0, 480_000);
    expect(rounds[0].strikes).toBe(1);
    expect(rounds[1].strikes).toBe(1);
  });

  it("respects a 2:00 round length", () => {
    const log = [strike(110_000), strike(130_000)]; // 1:50 work, 2:10 rest
    const rounds = bucketRounds(log, 0, 360_000, 120);
    expect(rounds[0].strikes).toBe(1);
  });

  it("ignores strikes before the rounds anchor", () => {
    const rounds = bucketRounds([strike(5_000)], 10_000, 250_000);
    expect(rounds[0].strikes).toBe(0);
  });

  it("counts slow-guard strikes per round", () => {
    const log = [strike(10_000, 7, 700), strike(20_000, 7, 300)];
    expect(bucketRounds(log, 0, 240_000)[0].slowGuard).toBe(1);
  });

  it("averages speed only over that round's strikes", () => {
    const log = [strike(10_000, 6), strike(20_000, 8), strike(250_000, 4)];
    const rounds = bucketRounds(log, 0, 480_000);
    expect(rounds[0].avgSpeed).toBe(7);
    expect(rounds[1].avgSpeed).toBe(4);
  });
});

describe("parseDrillDuration", () => {
  it("parses every format the content library uses", () => {
    expect(parseDrillDuration("3x2min")).toEqual({ rounds: 3, workS: 120 });
    expect(parseDrillDuration("3x90s")).toEqual({ rounds: 3, workS: 90 });
    expect(parseDrillDuration("4x1min")).toEqual({ rounds: 4, workS: 60 });
    expect(parseDrillDuration("6x60s (20s high output / 40s active guard)")).toEqual({
      rounds: 6,
      workS: 60,
    });
  });

  it("rejects freeform and absurd plans", () => {
    expect(parseDrillDuration("until sharp")).toBeNull();
    expect(parseDrillDuration("99x2min")).toBeNull(); // >20 rounds
    expect(parseDrillDuration("3x5s")).toBeNull(); // <20s work
  });

  it("every startable library drill parses; freeform ones are read-only", async () => {
    const { DRILLS } = await import("./drills.gen");
    const startable = DRILLS.filter((d) => parseDrillDuration(d.duration) != null);
    expect(startable.length).toBe(DRILLS.length); // all current durations parse
  });
});
