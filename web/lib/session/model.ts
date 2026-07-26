/**
 * Session domain model: types, display constants, and pure helpers shared by
 * the live session page. No React, no browser APIs (except types) — keep it
 * that way so logic stays unit-testable and the page stays wiring.
 */

// MediaPipe landmark index → canonical joint index (mirrors tools/ingest).
export const MP_TO_CANON: Array<[number, number]> = [
  [0, 0], [7, 1], [8, 2], [11, 3], [12, 4], [13, 5], [14, 6], [15, 7], [16, 8],
  [23, 9], [24, 10], [25, 11], [26, 12], [27, 13], [28, 14], [29, 15], [30, 16],
  [31, 17], [32, 18],
];
export const JOINTS = 21;
export const BONES: Array<[number, number]> = [
  [3, 4], [3, 5], [5, 7], [4, 6], [6, 8], [3, 9], [4, 10], [9, 10],
  [9, 11], [11, 13], [10, 12], [12, 14], [13, 15], [15, 17], [14, 16], [16, 18],
];

export type LastStrike = {
  hand: string;
  peak_speed: number;
  extension_frac: number | null;
  guard_recovery_ms: number | null;
  straightness: number | null;
  /** "straight" | "curved" | null — coarse path geometry, not punch class. */
  shape: string | null;
};

export type Hud = {
  status: string;
  fps: number;
  poseDetected: boolean;
  strikes: number;
  last: LastStrike | null;
  profileReady: boolean;
  /** Seconds since the camera went live. */
  elapsed: number;
  /** Round-timer state, or null in freestyle mode. */
  round: { n: number; phase: "work" | "rest"; remaining: number } | null;
  /** Debounced guard state id ("" = unknown/unprofiled). */
  guard: string;
  /** True when fps or pose-visibility is too low for trustworthy numbers. */
  lowQuality: boolean;
};

export const ROUND_WORK_S = 180;
export const ROUND_REST_S = 60;
export const ROUND_CYCLE_S = ROUND_WORK_S + ROUND_REST_S;

export type Summary = {
  duration_ms: number;
  strikes_left: number;
  strikes_right: number;
  avg_peak_speed: number | null;
  avg_peak_speed_left: number | null;
  avg_peak_speed_right: number | null;
  max_peak_speed: number | null;
  avg_guard_recovery_ms: number | null;
  strikes_per_min: number | null;
  guard_up_frac: number | null;
  bounce_cadence_hz: number | null;
  rhythm_predictability: number | null;
  /** Epoch ms; stamped when saved to history. */
  at: number;
};

export type StrikeLogItem = {
  t_ms: number;
  hand: string;
  peak_speed: number;
  guard_recovery_ms: number | null;
};

export type ComboItem = { start_ms: number; n: number; avg_interval_ms: number };

export type RoundStat = {
  n: number; // 1-based round number
  strikes: number;
  avgSpeed: number | null;
  slowGuard: number; // strikes with recovery > 550ms
};

/** Guard pill: id → [label, background]. Warnings only after sustained drop. */
export const GUARD_VIEW: Record<string, [string, string]> = {
  both_high: ["guard up", "#16341fdd"],
  lead_down: ["lead hand low", "#4a2410dd"],
  rear_down: ["rear hand low", "#4a2410dd"],
  both_down: ["hands low!", "#4a1010dd"],
};
export const GUARD_WARN_SUSTAIN_MS = 800;

/** Chain gap for the live combo indicator — matches the core assembler's
 *  600ms apex-gap rule (core/src/combos.rs via combos_json). */
export const COMBO_GAP_MS = 600;

/** Speeds above this are pose glitches (elite hands top out ~13 m/s), not PBs. */
export const PB_SANITY_MPS = 15;

/** Cue id (from the Metrics Core fault layer) → words. One cue at a time. */
export const CUE_TEXT: Record<string, string> = {
  hands_drop_after_punch: "Hands back to guard faster",
  overextension: "Don't overreach — stay inside your range",
};
export const CUE_SHOW_MS = 2800;
export const CUE_GAP_MS = 6000;

/** Bucket work-phase strikes into rounds. offsetMs = rounds start relative
 *  to the session clock; strikes before it (or in rest) are not counted. */
export function bucketRounds(
  log: StrikeLogItem[],
  offsetMs: number,
  durationMs: number,
): RoundStat[] {
  const cycle = ROUND_CYCLE_S * 1000;
  const work = ROUND_WORK_S * 1000;
  const count = Math.max(1, Math.floor(Math.max(0, durationMs - offsetMs) / cycle) + 1);
  const rounds: RoundStat[] = Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    strikes: 0,
    avgSpeed: null,
    slowGuard: 0,
  }));
  const speeds: number[][] = rounds.map(() => []);
  for (const k of log) {
    const rel = k.t_ms - offsetMs;
    if (rel < 0) continue;
    const n = Math.floor(rel / cycle);
    if (n >= rounds.length || rel % cycle >= work) continue;
    rounds[n].strikes++;
    speeds[n].push(k.peak_speed);
    if (k.guard_recovery_ms != null && k.guard_recovery_ms > 550) rounds[n].slowGuard++;
  }
  rounds.forEach((r, i) => {
    if (speeds[i].length) r.avgSpeed = speeds[i].reduce((a, b) => a + b, 0) / speeds[i].length;
  });
  return rounds;
}
