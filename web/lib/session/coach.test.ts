import { describe, expect, it } from "vitest";

import { coachTip } from "./coach";
import { punchMix } from "./model";
import type { StrikeLogItem, Summary } from "./model";

function summary(over: Partial<Summary> = {}): Summary {
  return {
    duration_ms: 300_000,
    strikes_left: 10,
    strikes_right: 10,
    avg_peak_speed: 6,
    avg_peak_speed_left: 6,
    avg_peak_speed_right: 6,
    max_peak_speed: 9,
    avg_guard_recovery_ms: 300,
    strikes_per_min: 4,
    guard_up_frac: 0.9,
    bounce_cadence_hz: 1.5,
    rhythm_predictability: 0.4,
    steps: 40,
    avg_stance_width_m: 0.6,
    stance_oob_frac: 0.1,
    at: 0,
    ...over,
  };
}

function strikes(n: number, recovery: number | null): StrikeLogItem[] {
  return Array.from({ length: n }, (_, i) => ({
    t_ms: i * 1000,
    hand: "left",
    peak_speed: 6,
    guard_recovery_ms: recovery,
  }));
}

describe("coachTip", () => {
  it("returns null on a clean session", () => {
    expect(coachTip(summary(), strikes(10, 300))).toBeNull();
  });

  it("flags slow guard recovery with the measured numbers", () => {
    const tip = coachTip(summary({ avg_guard_recovery_ms: 700 }), strikes(10, 700));
    expect(tip?.fault).toBe("hands_drop_after_punch");
    expect(tip?.headline).toContain("100%");
    expect(tip?.headline).toContain("700 ms");
    expect(tip?.drillId).toBe("mirror_return_high");
  });

  it("stays silent on guard recovery below the sample floor", () => {
    // 4 measured strikes is not enough evidence to coach on.
    expect(coachTip(summary({ avg_guard_recovery_ms: 700 }), strikes(4, 700))).toBeNull();
  });

  it("fires on slow-fraction even when the average looks fine", () => {
    const log = [...strikes(4, 200), ...strikes(2, 900)]; // 33% slow
    const tip = coachTip(summary({ avg_guard_recovery_ms: 433 }), log);
    expect(tip?.fault).toBe("hands_drop_after_punch");
  });

  it("prioritizes defense over rhythm when both fire", () => {
    const tip = coachTip(
      summary({ avg_guard_recovery_ms: 700, rhythm_predictability: 0.9 }),
      strikes(10, 700),
    );
    expect(tip?.fault).toBe("hands_drop_after_punch");
  });

  it("flags a low guard between exchanges", () => {
    const tip = coachTip(summary({ guard_up_frac: 0.3 }), strikes(10, 300));
    expect(tip?.fault).toBe("guard_low_at_rest");
    expect(tip?.headline).toContain("30%");
  });

  it("respects the honesty gate: unmeasured guard_up_frac never fires", () => {
    expect(coachTip(summary({ guard_up_frac: null }), strikes(10, 300))).toBeNull();
  });

  it("flags predictable rhythm", () => {
    const tip = coachTip(summary({ rhythm_predictability: 0.9 }), strikes(10, 300));
    expect(tip?.fault).toBe("predictable_rhythm");
    expect(tip?.drillId).toBe("broken_rhythm_rounds");
  });

  it("flags stance width drift", () => {
    const tip = coachTip(summary({ stance_oob_frac: 0.5 }), strikes(10, 300));
    expect(tip?.fault).toBe("stance_too_narrow");
  });
});

describe("punchMix", () => {
  it("counts labels and buckets unnamed strikes as other", () => {
    const log: StrikeLogItem[] = [
      { t_ms: 0, hand: "left", peak_speed: 6, guard_recovery_ms: null, label: "jab" },
      { t_ms: 1, hand: "left", peak_speed: 6, guard_recovery_ms: null, label: "jab" },
      { t_ms: 2, hand: "right", peak_speed: 7, guard_recovery_ms: null, label: "cross" },
      { t_ms: 3, hand: "right", peak_speed: 7, guard_recovery_ms: null, label: "hook" },
      { t_ms: 4, hand: "left", peak_speed: 5, guard_recovery_ms: null, label: null },
      { t_ms: 5, hand: "left", peak_speed: 5, guard_recovery_ms: null }, // legacy item, no field
    ];
    expect(punchMix(log)).toEqual({ jab: 2, cross: 1, hook: 1, other: 2 });
  });
});
