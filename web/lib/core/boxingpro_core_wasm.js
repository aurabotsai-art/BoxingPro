let wasm;

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedFloat64ArrayMemory0 = null;

function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let WASM_VECTOR_LEN = 0;

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

const SessionAnalyzerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sessionanalyzer_free(ptr >>> 0, 1));

export class SessionAnalyzer {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SessionAnalyzerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sessionanalyzer_free(ptr, 0);
    }
    /**
     * Push one frame. `joints` must be 21×4 (x, y, z, confidence); z=NaN
     * when unknown. Coordinates in meters (MediaPipe world landmarks).
     * @param {number} t_ms
     * @param {Float64Array} joints
     */
    push_frame(t_ms, joints) {
        const ptr0 = passArrayF64ToWasm0(joints, wasm.__wbindgen_export_0);
        const len0 = WASM_VECTOR_LEN;
        wasm.sessionanalyzer_push_frame(this.__wbg_ptr, t_ms, ptr0, len0);
    }
    /**
     * Declare the boxer's stance ("orthodox" | "southpaw"). Applies to the
     * current profile immediately and to every future profile refresh.
     * @param {string} stance
     */
    set_stance(stance) {
        const ptr0 = passStringToWasm0(stance, wasm.__wbindgen_export_0, wasm.__wbindgen_export_1);
        const len0 = WASM_VECTOR_LEN;
        wasm.sessionanalyzer_set_stance(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {number}
     */
    frame_count() {
        const ret = wasm.sessionanalyzer_frame_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    has_profile() {
        const ret = wasm.sessionanalyzer_has_profile(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Serialize the session as a schema-valid SkeletonArchive v1 document
     * (contracts/skeleton_archive.v1.schema.json), `t_ms` rebased to the
     * first frame. Coordinate space is camera_metric (MediaPipe world
     * landmarks are estimated meters); scale anchor stays "uncalibrated"
     * until real calibration exists — downstream consumers gate on that.
     * @param {string} session_id
     * @param {string} profile_id
     * @param {string} pose_model_id
     * @param {string} device_model
     * @param {number} fps_nominal
     * @param {number} width
     * @param {number} height
     * @returns {string}
     */
    archive_json(session_id, profile_id, pose_model_id, device_model, fps_nominal, width, height) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_export_0, wasm.__wbindgen_export_1);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(profile_id, wasm.__wbindgen_export_0, wasm.__wbindgen_export_1);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(pose_model_id, wasm.__wbindgen_export_0, wasm.__wbindgen_export_1);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(device_model, wasm.__wbindgen_export_0, wasm.__wbindgen_export_1);
            const len3 = WASM_VECTOR_LEN;
            wasm.sessionanalyzer_archive_json(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, fps_nominal, width, height);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred5_0 = r0;
            deferred5_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export_2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Live strike count across both hands. O(1): the incremental detectors
     * (batch-equivalent, see core pipeline tests) maintain it per frame.
     * @returns {number}
     */
    strike_count() {
        const ret = wasm.sessionanalyzer_strike_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * All completed strikes, chronological, as a JSON array. `t_ms` is
     * relative to the session's first frame. Guard recovery is null until
     * the profile locks; extension is omitted pending calibrated profiles
     * (see `last_strike_cue`).
     * @returns {string}
     */
    strikes_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sessionanalyzer_strikes_json(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export_2(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Whole-session summary as JSON: counts per hand, speed stats, average
     * guard recovery. Deterministic Metrics Core numbers only; anything
     * unobservable is `null` (honesty rule, docs/03).
     * @returns {string}
     */
    summary_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sessionanalyzer_summary_json(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export_2(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Current guard state from the newest frame: `"both_high"`,
     * `"lead_down"`, `"rear_down"`, `"both_down"`, or `""` when unprofiled
     * or a wrist is unobserved. Flicker handling (punches drop the guard by
     * definition for ~200ms) belongs to the caller.
     * @returns {string}
     */
    guard_state_now() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sessionanalyzer_guard_state_now(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export_2(deferred1_0, deferred1_1, 1);
        }
    }
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
     * @returns {string}
     */
    last_strike_cue() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sessionanalyzer_last_strike_cue(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export_2(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * JSON summary of the most recent strike (speed, extension, guard
     * recovery) or `null` if none/unprofiled. Numbers via the same Metrics
     * Core code paths as every other tier.
     * @returns {string}
     */
    last_strike_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sessionanalyzer_last_strike_json(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export_2(deferred1_0, deferred1_1, 1);
        }
    }
    constructor() {
        const ret = wasm.sessionanalyzer_new();
        this.__wbg_ptr = ret >>> 0;
        SessionAnalyzerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Current stance as a string (for HUD/state display).
     * @returns {string}
     */
    stance() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sessionanalyzer_stance(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export_2(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) SessionAnalyzer.prototype[Symbol.dispose] = SessionAnalyzer.prototype.free;

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_wbindgenthrow_451ec1a8469d7eb6 = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };

    return imports;
}

function __wbg_init_memory(imports, memory) {

}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;



    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    __wbg_init_memory(imports);

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('boxingpro_core_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    __wbg_init_memory(imports);

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
