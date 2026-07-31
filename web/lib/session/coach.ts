/**
 * Deterministic post-session coach: maps the session's worst *measured*
 * fault to one drill from the content library (content/faults + drills).
 * Same philosophy as coach_brain/render_template.py — numbers come from the
 * Metrics Core, words from fixed templates, nothing invented. Rules fire
 * only when the underlying metric was actually measured (docs/03 honesty
 * tiers); priority order mirrors core/src/prioritize.rs: defense first,
 * then rhythm, then footwork.
 */
import type { StrikeLogItem, Summary } from "./model";

export type CoachTip = {
  /** Fault id from content/faults/. */
  fault: string;
  /** What was measured, with the number, in plain words. */
  headline: string;
  /** One-line coaching instruction. */
  fix: string;
  /** Drill id + display name from content/drills/. */
  drillId: string;
  drill: string;
};

/** Guard-recovery threshold shared with the live cue + round stats (ms). */
export const SLOW_GUARD_MS = 550;
/** Minimum measured strikes before guard-recovery stats are trustworthy. */
export const MIN_RECOVERY_SAMPLES = 5;

export function coachTip(s: Summary, log: StrikeLogItem[]): CoachTip | null {
  // 1. Hands dropping after punches — the highest-exposure defensive fault.
  const rec = log.filter((k) => k.guard_recovery_ms != null);
  if (rec.length >= MIN_RECOVERY_SAMPLES) {
    const slow = rec.filter((k) => (k.guard_recovery_ms as number) > SLOW_GUARD_MS).length;
    const slowFrac = slow / rec.length;
    if ((s.avg_guard_recovery_ms != null && s.avg_guard_recovery_ms > SLOW_GUARD_MS) || slowFrac >= 0.3) {
      return {
        fault: "hands_drop_after_punch",
        headline: `Hands stayed down after ${Math.round(slowFrac * 100)}% of punches${
          s.avg_guard_recovery_ms != null ? ` (avg return ${Math.round(s.avg_guard_recovery_ms)} ms)` : ""
        }`,
        fix: "Snap the hand straight back to your cheek after every shot — the punch isn't over until it's home.",
        drillId: "mirror_return_high",
        drill: "Snap-back rounds",
      };
    }
  }
  // 2. Guard low between exchanges.
  if (s.guard_up_frac != null && s.guard_up_frac < 0.5) {
    return {
      fault: "guard_low_at_rest",
      headline: `Guard was up only ${Math.round(s.guard_up_frac * 100)}% of the session`,
      fix: "Live with your hands at your cheekbones — resting position IS your guard.",
      drillId: "guard_discipline_rounds",
      drill: "Guard discipline rounds",
    };
  }
  // 3. Predictable rhythm — readable fighters get timed.
  if (s.rhythm_predictability != null && s.rhythm_predictability > 0.75) {
    return {
      fault: "predictable_rhythm",
      headline: `Your movement rhythm was ${Math.round(s.rhythm_predictability * 100)}% predictable`,
      fix: "Break the beat — mix half-steps, pauses and bursts so nobody can time you.",
      drillId: "broken_rhythm_rounds",
      drill: "Broken rhythm rounds",
    };
  }
  // 4. Stance width drifting out of the workable band.
  if (s.stance_oob_frac != null && s.stance_oob_frac > 0.35) {
    return {
      fault: "stance_too_narrow",
      headline: `Stance width was outside the good band ${Math.round(s.stance_oob_frac * 100)}% of the time`,
      fix: "Reset your feet after every exchange — balance comes before power.",
      drillId: "stance_reset_steps",
      drill: "Stance reset stepping",
    };
  }
  // Nothing measurable to fix — the UI shows the positive path.
  return null;
}
