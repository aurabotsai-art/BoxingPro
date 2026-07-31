/* tslint:disable */
/* eslint-disable */
export class SessionAnalyzer {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Push one frame. `joints` must be 21×4 (x, y, z, confidence); z=NaN
   * when unknown. Coordinates in meters (MediaPipe world landmarks).
   */
  push_frame(t_ms: number, joints: Float64Array): void;
  /**
   * Declare the boxer's stance ("orthodox" | "southpaw"). Applies to the
   * current profile immediately and to every future profile refresh.
   */
  set_stance(stance: string): void;
  /**
   * Combos — bursts of ≥2 strikes with ≤600ms between apexes — as a JSON
   * array of `{start_ms, n, avg_interval_ms, notation}` (session-relative
   * time). Strikes carry the same heuristic class as the strike card
   * ("1-1-2"; ambiguous shapes render "?" — the assembler chains them
   * honestly instead of dropping them).
   */
  combos_json(): string;
  frame_count(): number;
  has_profile(): boolean;
  /**
   * Serialize the session as a schema-valid SkeletonArchive v1 document
   * (contracts/skeleton_archive.v1.schema.json), `t_ms` rebased to the
   * first frame. Coordinate space is camera_metric (MediaPipe world
   * landmarks are estimated meters); scale anchor stays "uncalibrated"
   * until real calibration exists — downstream consumers gate on that.
   */
  archive_json(session_id: string, profile_id: string, pose_model_id: string, device_model: string, fps_nominal: number, width: number, height: number): string;
  /**
   * Live strike count across both hands. O(1): the incremental detectors
   * (batch-equivalent, see core pipeline tests) maintain it per frame.
   */
  strike_count(): number;
  /**
   * All completed strikes, chronological, as a JSON array. `t_ms` is
   * relative to the session's first frame. Guard recovery is null until
   * the profile locks; extension is omitted pending calibrated profiles
   * (see `last_strike_cue`).
   */
  strikes_json(): string;
  /**
   * Whole-session summary as JSON: counts per hand, speed stats, average
   * guard recovery. Deterministic Metrics Core numbers only; anything
   * unobservable is `null` (honesty rule, docs/03).
   */
  summary_json(): string;
  /**
   * Current guard state from the newest frame: `"both_high"`,
   * `"lead_down"`, `"rear_down"`, `"both_down"`, or `""` when unprofiled
   * or a wrist is unobserved. Flicker handling (punches drop the guard by
   * definition for ~200ms) belongs to the caller.
   */
  guard_state_now(): string;
  /**
   * Live cue id for the most recent completed strike:
   * `"hands_drop_after_punch"`, or `""` when clean or unmeasurable. Same
   * thresholds as the session fault layer (`FaultThresholds` novice
   * defaults, docs/05 stage 8); cue pacing and wording belong to the UI.
   *
   * Overextension is deliberately NOT cued here: the auto-profile derives
   * arm length from the p95 of this session's own reach, so a full honest
   * extension measures slightly over 1.0 by construction — cueing on it
   * would be pseudo-precision (docs/03). It returns once profiles come
   * from real calibration.
   */
  last_strike_cue(): string;
  /**
   * JSON summary of the most recent strike (speed, extension, guard
   * recovery) or `null` if none/unprofiled. Numbers via the same Metrics
   * Core code paths as every other tier.
   */
  last_strike_json(): string;
  constructor();
  /**
   * Current stance as a string (for HUD/state display).
   */
  stance(): string;
  /**
   * True once the session hit the frame cap; pushes are ignored from
   * then on. The UI auto-ends the session to save what was measured.
   */
  is_full(): boolean;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_sessionanalyzer_free: (a: number, b: number) => void;
  readonly sessionanalyzer_archive_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
  readonly sessionanalyzer_combos_json: (a: number, b: number) => void;
  readonly sessionanalyzer_frame_count: (a: number) => number;
  readonly sessionanalyzer_guard_state_now: (a: number, b: number) => void;
  readonly sessionanalyzer_has_profile: (a: number) => number;
  readonly sessionanalyzer_is_full: (a: number) => number;
  readonly sessionanalyzer_last_strike_cue: (a: number, b: number) => void;
  readonly sessionanalyzer_last_strike_json: (a: number, b: number) => void;
  readonly sessionanalyzer_new: () => number;
  readonly sessionanalyzer_push_frame: (a: number, b: number, c: number, d: number) => void;
  readonly sessionanalyzer_set_stance: (a: number, b: number, c: number) => void;
  readonly sessionanalyzer_stance: (a: number, b: number) => void;
  readonly sessionanalyzer_strike_count: (a: number) => number;
  readonly sessionanalyzer_strikes_json: (a: number, b: number) => void;
  readonly sessionanalyzer_summary_json: (a: number, b: number) => void;
  readonly __wbindgen_export_0: (a: number, b: number) => number;
  readonly __wbindgen_export_1: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_export_2: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
