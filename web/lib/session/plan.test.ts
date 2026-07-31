import { describe, expect, it } from "vitest";

import { suggestDrill } from "./plan";
import type { DrillResult } from "./storage";
import type { Summary } from "./model";

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

const IDS = ["bounce_rhythm_rounds", "mirror_return_high", "range_marker_jabs"];
const result = (drillId: string, verdict: DrillResult["verdict"]): DrillResult => ({
  drillId,
  at: 0,
  verdict,
});

describe("suggestDrill", () => {
  it("fixes the last session's measured fault first", () => {
    const s = suggestDrill([summary({ avg_guard_recovery_ms: 700 })], [], IDS);
    expect(s?.drillId).toBe("mirror_return_high");
    expect(s?.reason).toContain("700 ms");
  });

  it("fault priority beats an unfinished streak", () => {
    const s = suggestDrill(
      [summary({ rhythm_predictability: 0.9 })],
      [result("range_marker_jabs", "pass")],
      IDS,
    );
    expect(s?.drillId).toBe("broken_rhythm_rounds");
  });

  it("continues an unfinished mastery streak when the last session was clean", () => {
    const s = suggestDrill([summary()], [result("mirror_return_high", "pass")], IDS);
    expect(s?.drillId).toBe("mirror_return_high");
    expect(s?.reason).toContain("1/3");
  });

  it("skips mastered drills and suggests something untried", () => {
    const log = [
      result("mirror_return_high", "pass"),
      result("mirror_return_high", "pass"),
      result("mirror_return_high", "pass"),
    ];
    const s = suggestDrill([summary()], log, IDS);
    expect(s?.drillId).toBe("bounce_rhythm_rounds");
    expect(s?.reason).toContain("new drill");
  });

  it("suggests nothing for a brand-new user (onboarding owns that moment)", () => {
    expect(suggestDrill([], [], IDS)).toBeNull();
  });

  it("honesty: unmeasured metrics never trigger a fault suggestion", () => {
    const s = suggestDrill(
      [summary({ avg_guard_recovery_ms: null, guard_up_frac: null, rhythm_predictability: null, stance_oob_frac: null })],
      [],
      IDS,
    );
    // Falls through to (c): never-tried drill.
    expect(s?.reason).toContain("new drill");
  });
});
