/**
 * Combo caller for guided drills whose protocols say "App calls ..."
 * (content/drills: mirror_return_high, prompt_double_return,
 * prompt_random_combos). Pure logic here — the page speaks/flashes the
 * calls. Deterministic via an injected RNG so tests can replay sequences.
 */

export type CallPlan = {
  /** Combos in boxing notation to draw from. */
  pool: string[];
  /** Mean gap between calls; actual gaps jitter ±30% so rhythm can't be
   *  predicted (the point of a caller). */
  everyMs: number;
};

/** Drill id → call plan. Drills absent here run silent (timer-only). */
export const CALL_PLANS: Record<string, CallPlan> = {
  // "App calls single shots and doubles at moderate tempo."
  mirror_return_high: { pool: ["1", "2", "1-1", "1-2"], everyMs: 4000 },
  // "Punish the lazy return": singles/doubles, return graded.
  prompt_double_return: { pool: ["1", "1-1", "2", "1-2"], everyMs: 4000 },
  // "Random combination calls."
  prompt_random_combos: {
    pool: ["1-2", "1-1-2", "1-2-3", "3-2", "1-2-1", "2-3-2", "1-4", "1-2-3-2"],
    everyMs: 5000,
  },
  // "App calls 'check' at random intervals; user resets posture."
  chin_tuck_rounds: { pool: ["check"], everyMs: 8000 },
  // "App calls slip-left / slip-right / roll" — defensive reactions.
  head_movement_u_drill: { pool: ["slip left", "slip right", "roll"], everyMs: 3500 },
  // "App calls left/right movement bursts" — step-drag grading.
  lateral_step_drills: { pool: ["step left", "step right"], everyMs: 4000 },
  // "App calls single jabs at moderate tempo" — wall telegraph drill.
  no_windup_wall_jabs: { pool: ["1"], everyMs: 3000 },
  // "App calls jabs" against the virtual range marker.
  range_marker_jabs: { pool: ["1"], everyMs: 3500 },
  // "App calls step directions at building tempo."
  stance_reset_steps: {
    pool: ["step forward", "step back", "step left", "step right", "pivot"],
    everyMs: 4000,
  },
  // "App calls 'step-jab' reps" — foot lands as fist lands.
  step_jab_sync: { pool: ["step jab"], everyMs: 3500 },
};

/** mulberry32 — tiny deterministic PRNG; good enough for call shuffling. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick the next call: never the same combo twice in a row. */
export function nextCall(plan: CallPlan, rand: () => number, prev: string | null): string {
  const pool = plan.pool.length > 1 && prev ? plan.pool.filter((c) => c !== prev) : plan.pool;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/** Gap to the next call with ±30% jitter. */
export function nextGapMs(plan: CallPlan, rand: () => number): number {
  return plan.everyMs * (0.7 + 0.6 * rand());
}

const WORDS = ["", "one", "two", "three", "four", "five", "six"];

/** "1-1-2" → "one one two" — digits are ambiguous over gym speakers. */
export function callWords(notation: string): string {
  return notation
    .split("-")
    .map((d) => WORDS[Number(d)] ?? d)
    .join(" ");
}
