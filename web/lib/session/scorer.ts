/**
 * Drill scorecards: grade a completed guided drill against the measurable
 * part of its content success_criterion, using only strikes thrown inside
 * the drill window. Honesty rules (docs/03): a drill is only graded when
 * its criterion maps to metrics we actually measure with enough samples;
 * everything else gets a completion card, never a made-up grade.
 */
import type { StrikeLogItem } from "./model";

export type Scorecard = {
  drillId: string;
  /** "pass" | "work" (measured, needs work) | "info" (measured, no
   *  content-defined threshold) | null (not gradable → completion only). */
  verdict: "pass" | "work" | "info" | null;
  lines: string[];
};

/** Minimum measured strikes before a grade is honest. */
export const MIN_SAMPLES = 6;

export function p75(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(v.length * 0.75))];
}

/** Coefficient of variation of inter-strike gaps — the "unpredictability"
 *  number prompt_random_combos trains upward. */
export function cadenceCV(strikes: StrikeLogItem[]): number | null {
  if (strikes.length < MIN_SAMPLES) return null;
  const gaps: number[] = [];
  for (let i = 1; i < strikes.length; i++) gaps.push(strikes[i].t_ms - strikes[i - 1].t_ms);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return null;
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  return sd / mean;
}

/** Grade guard-return drills: content criterion p75(guard_recovery_ms) < 450. */
function gradeGuardReturn(drillId: string, strikes: StrikeLogItem[]): Scorecard {
  const rec = strikes
    .map((s) => s.guard_recovery_ms)
    .filter((v): v is number => v != null);
  if (rec.length < MIN_SAMPLES) {
    return {
      drillId,
      verdict: null,
      lines: [`${strikes.length} punches thrown — too few measured returns to grade (need ${MIN_SAMPLES})`],
    };
  }
  const p = Math.round(p75(rec) as number);
  return {
    drillId,
    verdict: p < 450 ? "pass" : "work",
    lines: [
      `p75 guard return: ${p} ms (target < 450)`,
      `${rec.length} returns measured`,
      p < 450 ? "Criterion met — hold it for 3 straight sessions" : "Keep snapping the hand home",
    ],
  };
}

export function scoreDrill(drillId: string, strikes: StrikeLogItem[]): Scorecard {
  switch (drillId) {
    case "mirror_return_high":
    case "prompt_double_return":
      return gradeGuardReturn(drillId, strikes);
    case "prompt_random_combos": {
      const cv = cadenceCV(strikes);
      if (cv == null) {
        return { drillId, verdict: null, lines: [`${strikes.length} punches — too few to measure cadence variance`] };
      }
      // Content sets the bar relative to a population p40 we don't have yet
      // (needs M2 data) — so report the number, no invented pass/fail.
      return {
        drillId,
        verdict: "info",
        lines: [
          `Cadence variance: ${(cv * 100).toFixed(0)}% (higher = harder to time)`,
          `${strikes.length} punches across the drill`,
        ],
      };
    }
    default:
      return {
        drillId,
        verdict: null,
        lines: strikes.length ? [`${strikes.length} punches thrown`] : [],
      };
  }
}
