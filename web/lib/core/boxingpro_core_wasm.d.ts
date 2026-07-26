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
  frame_count(): number;
  has_profile(): boolean;
  /**
   * Live strike count across both hands (recomputed on call; cheap at
   * session scale, incremental version lands with the Tier-1 optimizer).
   */
  strike_count(): number;
  /**
   * JSON summary of the most recent strike (speed, extension, guard
   * recovery) or `null` if none/unprofiled. Numbers via the same Metrics
   * Core code paths as every other tier.
   */
  last_strike_json(): string;
  constructor();
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_sessionanalyzer_free: (a: number, b: number) => void;
  readonly sessionanalyzer_frame_count: (a: number) => number;
  readonly sessionanalyzer_has_profile: (a: number) => number;
  readonly sessionanalyzer_last_strike_json: (a: number, b: number) => void;
  readonly sessionanalyzer_new: () => number;
  readonly sessionanalyzer_push_frame: (a: number, b: number, c: number, d: number) => void;
  readonly sessionanalyzer_strike_count: (a: number) => number;
  readonly __wbindgen_export_0: (a: number, b: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_export_1: (a: number, b: number, c: number) => void;
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
