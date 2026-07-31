/**
 * Today's plan: pick ONE drill to suggest when the app opens, from
 * (a) the last session's worst measured fault — same thresholds as the
 * post-session coach, (b) an unfinished mastery streak worth continuing,
 * (c) a caller drill never tried. Honesty rules apply: fault rules only
 * fire on measured metrics; no data → no suggestion.
 */
import { MASTERY_STREAK, passStreak } from "./scorer";
import type { Summary } from "./model";
import type { DrillResult } from "./storage";

export type PlanSuggestion = {
  drillId: string;
  /** Short human reason shown on the chip. */
  reason: string;
};

/** Fault→drill map, mirroring coach.ts priorities (defense → rhythm →
 *  footwork). Thresholds identical to the coach card. */
function faultDrill(s: Summary): PlanSuggestion | null {
  if (s.avg_guard_recovery_ms != null && s.avg_guard_recovery_ms > 550) {
    return {
      drillId: "mirror_return_high",
      reason: `last session: guard returned in ${Math.round(s.avg_guard_recovery_ms)} ms avg`,
    };
  }
  if (s.guard_up_frac != null && s.guard_up_frac < 0.5) {
    return {
      drillId: "guard_discipline_rounds",
      reason: `last session: guard up only ${Math.round(s.guard_up_frac * 100)}%`,
    };
  }
  if (s.rhythm_predictability != null && s.rhythm_predictability > 0.75) {
    return {
      drillId: "broken_rhythm_rounds",
      reason: `last session: rhythm ${Math.round(s.rhythm_predictability * 100)}% predictable`,
    };
  }
  if (s.stance_oob_frac != null && s.stance_oob_frac > 0.35) {
    return {
      drillId: "stance_reset_steps",
      reason: `last session: stance off-base ${Math.round(s.stance_oob_frac * 100)}%`,
    };
  }
  return null;
}

export function suggestDrill(
  history: Summary[],
  drillLog: DrillResult[],
  allDrillIds: string[],
): PlanSuggestion | null {
  // (a) Fix what last session actually measured as broken.
  const last = history[0];
  if (last) {
    const fd = faultDrill(last);
    if (fd) return fd;
  }
  // (b) Continue a started-but-unfinished mastery streak (most recent first).
  const seen = new Set<string>();
  for (const r of drillLog) {
    if (seen.has(r.drillId)) continue;
    seen.add(r.drillId);
    const streak = passStreak(drillLog, r.drillId);
    if (streak > 0 && streak < MASTERY_STREAK) {
      return {
        drillId: r.drillId,
        reason: `${streak}/${MASTERY_STREAK} passes — finish the streak`,
      };
    }
  }
  // (c) Something never tried (only once training has actually begun).
  if (history.length > 0) {
    const tried = new Set(drillLog.map((r) => r.drillId));
    const fresh = allDrillIds.find((id) => !tried.has(id));
    if (fresh) return { drillId: fresh, reason: "new drill — expand your toolbox" };
  }
  return null;
}
