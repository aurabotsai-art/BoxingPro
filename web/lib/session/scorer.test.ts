import { describe, expect, it } from "vitest";

import { cadenceCV, MIN_SAMPLES, p75, scoreDrill } from "./scorer";
import type { StrikeLogItem } from "./model";

function strikes(recoveries: Array<number | null>, gapMs = 1000): StrikeLogItem[] {
  return recoveries.map((r, i) => ({
    t_ms: i * gapMs,
    hand: "left",
    peak_speed: 6,
    guard_recovery_ms: r,
  }));
}

describe("p75", () => {
  it("returns the 75th percentile", () => {
    expect(p75([100, 200, 300, 400])).toBe(400);
    expect(p75([1, 2, 3, 4, 5, 6, 7, 8])).toBe(7);
    expect(p75([])).toBeNull();
  });
});

describe("scoreDrill — guard-return drills", () => {
  it("passes when p75 recovery beats the content criterion (450ms)", () => {
    const sc = scoreDrill("mirror_return_high", strikes([300, 320, 350, 400, 410, 430, 300, 350]));
    expect(sc.verdict).toBe("pass");
    expect(sc.lines[0]).toContain("target < 450");
  });

  it("says 'work' when returns are slow", () => {
    const sc = scoreDrill("prompt_double_return", strikes([500, 600, 700, 550, 620, 480]));
    expect(sc.verdict).toBe("work");
  });

  it("refuses to grade below the sample floor", () => {
    const sc = scoreDrill("mirror_return_high", strikes([300, 300, 300, null, null]));
    expect(sc.verdict).toBeNull();
    expect(sc.lines[0]).toContain(`need ${MIN_SAMPLES}`);
  });
});

describe("scoreDrill — random combos", () => {
  it("reports cadence variance without inventing a pass/fail bar", () => {
    // Irregular gaps: 400, 2000, 600, 1500, 300, 900, 1200ms
    const t = [0, 400, 2400, 3000, 4500, 4800, 5700, 6900];
    const log = t.map((ms) => ({ t_ms: ms, hand: "left", peak_speed: 6, guard_recovery_ms: null }));
    const sc = scoreDrill("prompt_random_combos", log);
    expect(sc.verdict).toBe("info"); // population p40 needs M2 data — no fake bar
    expect(sc.lines[0]).toMatch(/Cadence variance: \d+%/);
  });

  it("cadenceCV is null under the sample floor and higher for irregular rhythm", () => {
    expect(cadenceCV(strikes([null, null, null]))).toBeNull();
    const regular = cadenceCV(strikes(Array(10).fill(null), 1000)) as number;
    const t = [0, 300, 1900, 2200, 4100, 4300, 6800, 7000, 9500, 9600];
    const irregular = cadenceCV(
      t.map((ms) => ({ t_ms: ms, hand: "left", peak_speed: 6, guard_recovery_ms: null })),
    ) as number;
    expect(regular).toBeLessThan(0.01);
    expect(irregular).toBeGreaterThan(0.5);
  });
});

describe("scoreDrill — ungradable drills stay honest", () => {
  it("gives a completion card, never a grade", () => {
    const sc = scoreDrill("bounce_rhythm_rounds", strikes([300, 300, 300, 300, 300, 300]));
    expect(sc.verdict).toBeNull();
    expect(sc.lines[0]).toBe("6 punches thrown");
  });
});
