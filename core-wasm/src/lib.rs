//! Browser API for the Metrics Core (docs/04 §4, Tier-1 path).
//!
//! JS pushes canonical-skeleton frames as flat arrays; this wrapper keeps the
//! session sequence and answers live queries (strike count, last-strike
//! metrics) plus a full end-of-session analysis. Same crate, same numbers as
//! the CLI and future server workers.
//!
//! Frame layout: `[x0, y0, z0, c0, x1, y1, z1, c1, …]` for the 21 canonical
//! joints (core/src/types.rs order). Unobserved joint = confidence 0;
//! unknown depth = NaN z. Feed MediaPipe WORLD landmarks (metric, meters) —
//! the detector thresholds are calibrated in m/s.

use boxingpro_core::events::{DetectorConfig, Hand, LiveDetector};
use boxingpro_core::filters::OneEuro;
use boxingpro_core::metrics::{strike_metrics, MetricsConfig};
use boxingpro_core::types::{BodyProfile, Keypoint, PoseFrame, Sequence, Stance, JOINT_COUNT};
use wasm_bindgen::prelude::*;

/// Raw frames as pushed, packed as f32 (t_ms stays f64): 344B/frame vs the
/// 848B PoseFrame layout. Only the archive/export path reads this — the
/// data flywheel wants sensor truth, not our smoothing choices, and f32
/// keeps ~7 significant digits, far beyond pose-estimate accuracy.
#[derive(Default)]
struct PackedFrames {
    t_ms: Vec<f64>,
    /// 84 floats per frame: 21 joints × (x, y, z, c); c == 0 → unobserved,
    /// NaN z → depth unknown.
    data: Vec<f32>,
}

impl PackedFrames {
    fn push(&mut self, t_ms: f64, joints: &[f64]) {
        self.t_ms.push(t_ms);
        let want = JOINT_COUNT * 4;
        self.data
            .extend(joints.iter().take(want).map(|v| *v as f32));
        for _ in joints.len().min(want)..want {
            self.data.push(0.0); // short input: pad as unobserved
        }
    }

    fn len(&self) -> usize {
        self.t_ms.len()
    }
}

#[wasm_bindgen]
pub struct SessionAnalyzer {
    raw: PackedFrames,
    /// One-Euro-filtered frames — the analysis path (detection, metrics,
    /// guard, profile). Phone-camera world landmarks jitter frame to frame;
    /// central-difference speed amplifies that noise into false strikes.
    seq_f: Sequence,
    filters: Vec<[OneEuro; 3]>,
    profile: Option<BodyProfile>,
    left: LiveDetector,
    right: LiveDetector,
    /// User-declared stance; applied to every (re)computed auto-profile.
    /// Manual input by design — stance auto-detection is not credible yet.
    stance: Stance,
}

fn auto_profile_from(seq: &Sequence) -> Option<BodyProfile> {
    // Minimal in-browser auto-profile: arm length from near-max wrist↔shoulder
    // distance, guard from median wrist position. Mirrors cli/src/main.rs; the
    // production Tier-1 path replaces this with the calibrated profile.
    use boxingpro_core::types::Joint;
    let mut reach = Vec::new();
    let mut lw: (Vec<f64>, Vec<f64>) = (vec![], vec![]);
    let mut rw: (Vec<f64>, Vec<f64>) = (vec![], vec![]);
    for f in &seq.frames {
        for (sh, wr, acc) in [
            (Joint::LeftShoulder, Joint::LeftWrist, &mut lw),
            (Joint::RightShoulder, Joint::RightWrist, &mut rw),
        ] {
            if let (Some(s), Some(w)) = (f.get(sh), f.get(wr)) {
                let dz = match (w.z, s.z) {
                    (Some(wz), Some(sz)) => wz - sz,
                    _ => 0.0,
                };
                reach.push(((w.x - s.x).powi(2) + (w.y - s.y).powi(2) + dz.powi(2)).sqrt());
                acc.0.push(w.x);
                acc.1.push(w.y);
            }
        }
    }
    if reach.len() < 30 {
        return None;
    }
    reach.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let arm = reach[(reach.len() as f64 * 0.95) as usize];
    let med = |mut v: Vec<f64>| {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        v[v.len() / 2]
    };
    Some(BodyProfile {
        height_m: 1.75,
        arm_length_m: arm,
        shoulder_width_m: arm * 0.65,
        stance: Stance::Orthodox,
        guard_left: [med(lw.0), med(lw.1)],
        guard_right: [med(rw.0), med(rw.1)],
    })
}

/// Hard frame cap ≈ 30min @ 30fps / 15min @ 60fps. Both sequences together
/// cost ~848B × 2 per frame (measured), so the cap bounds a session at
/// ~87MB — beyond it, low-end phones start dying. The UI auto-ends (saving
/// the summary + archive) when `is_full()` trips. Packed f32 storage is the
/// planned long-session fix (docs/12).
pub const MAX_SESSION_FRAMES: usize = 54_000;

/// Auto-profile refresh stops here: the guard median is stable long before
/// this, and each refresh is an O(n log n) sort over the whole session.
const PROFILE_REFRESH_MAX_FRAMES: usize = 3_000;

#[wasm_bindgen]
impl SessionAnalyzer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SessionAnalyzer {
        let cfg = DetectorConfig::default();
        SessionAnalyzer {
            raw: PackedFrames::default(),
            seq_f: Sequence::default(),
            filters: (0..JOINT_COUNT)
                .map(|_| {
                    [
                        OneEuro::keypoint_default(),
                        OneEuro::keypoint_default(),
                        OneEuro::keypoint_default(),
                    ]
                })
                .collect(),
            profile: None,
            left: LiveDetector::new(Hand::Left, cfg.clone()),
            right: LiveDetector::new(Hand::Right, cfg),
            stance: Stance::Orthodox,
        }
    }

    /// Declare the boxer's stance ("orthodox" | "southpaw"). Applies to the
    /// current profile immediately and to every future profile refresh.
    pub fn set_stance(&mut self, stance: &str) {
        self.stance = if stance == "southpaw" {
            Stance::Southpaw
        } else {
            Stance::Orthodox
        };
        if let Some(p) = &mut self.profile {
            p.stance = self.stance;
        }
    }

    /// Current stance as a string (for HUD/state display).
    pub fn stance(&self) -> String {
        match self.stance {
            Stance::Orthodox => "orthodox".into(),
            Stance::Southpaw => "southpaw".into(),
        }
    }

    /// Push one frame. `joints` must be 21×4 (x, y, z, confidence); z=NaN
    /// when unknown. Coordinates in meters (MediaPipe world landmarks).
    pub fn push_frame(&mut self, t_ms: f64, joints: &[f64]) {
        if self.raw.len() >= MAX_SESSION_FRAMES {
            return; // full: callers watch is_full() and auto-end
        }
        let mut pf = PoseFrame::empty(t_ms);
        for i in 0..JOINT_COUNT.min(joints.len() / 4) {
            let (x, y, z, c) = (
                joints[i * 4],
                joints[i * 4 + 1],
                joints[i * 4 + 2],
                joints[i * 4 + 3],
            );
            if c > 0.0 {
                pf.joints[i] = Some(Keypoint {
                    x,
                    y,
                    z: if z.is_finite() { Some(z) } else { None },
                    confidence: c,
                });
            }
        }
        // Filtered twin of the frame for the analysis path. The z channel's
        // filter only advances when depth is present, so gaps stay honest.
        let mut ff = PoseFrame::empty(t_ms);
        for (i, j) in pf.joints.iter().enumerate() {
            if let Some(k) = j {
                let f = &mut self.filters[i];
                ff.joints[i] = Some(Keypoint {
                    x: f[0].filter(t_ms, k.x),
                    y: f[1].filter(t_ms, k.y),
                    z: k.z.map(|z| f[2].filter(t_ms, z)),
                    confidence: k.confidence,
                });
            }
        }
        self.raw.push(t_ms, joints);
        self.seq_f.frames.push(ff);
        self.left.advance(&self.seq_f);
        self.right.advance(&self.seq_f);
        // Auto-profile: first estimate as soon as possible (every 60 frames
        // until one sticks), then keep refining every 300 frames — the guard
        // median converges as guard-position frames dominate the session,
        // washing out contamination from punches thrown during the first
        // seconds.
        let n = self.seq_f.frames.len();
        let refresh = (self.profile.is_none() && n.is_multiple_of(60))
            || (n <= PROFILE_REFRESH_MAX_FRAMES && n.is_multiple_of(300));
        if refresh {
            if let Some(mut p) = auto_profile_from(&self.seq_f) {
                p.stance = self.stance; // refresh must not clobber the declared stance
                self.profile = Some(p);
            }
        }
    }

    pub fn frame_count(&self) -> usize {
        self.raw.len()
    }

    /// True once the session hit the frame cap; pushes are ignored from
    /// then on. The UI auto-ends the session to save what was measured.
    pub fn is_full(&self) -> bool {
        self.raw.len() >= MAX_SESSION_FRAMES
    }

    /// Live strike count across both hands. O(1): the incremental detectors
    /// (batch-equivalent, see core pipeline tests) maintain it per frame.
    pub fn strike_count(&self) -> usize {
        self.left.candidates().len() + self.right.candidates().len()
    }

    fn last_candidate(&self) -> Option<(Hand, &boxingpro_core::events::StrikeCandidate)> {
        [&self.left, &self.right]
            .into_iter()
            .filter_map(|d| d.candidates().last().map(|c| (d.hand(), c)))
            .max_by(|a, b| a.1.peak_idx.cmp(&b.1.peak_idx))
    }

    /// JSON summary of the most recent strike (speed, extension, guard
    /// recovery) or `null` if none/unprofiled. Numbers via the same Metrics
    /// Core code paths as every other tier.
    pub fn last_strike_json(&self) -> String {
        let profile = match &self.profile {
            Some(p) => p,
            None => return "null".into(),
        };
        let Some((hand, c)) = self.last_candidate() else {
            return "null".into();
        };
        let m = strike_metrics(&self.seq_f, c, profile, &MetricsConfig::default());
        // Coarse path-shape readout from straightness (chord/path): honest
        // T1 geometry, NOT punch classification — a wide band stays null
        // rather than guessing (docs/03). Real classes come with the
        // trained classifier. Bands account for the analysis filter's
        // residual corner-cutting (probe_filter_params).
        let shape = match m.straightness {
            Some(s) if s >= 0.90 => "\"straight\"",
            Some(s) if s <= 0.80 => "\"curved\"",
            _ => "null",
        };
        // Extension honesty gate: until the auto-profile has seen a full
        // punch, arm_length is a guard-distance artifact and extension_frac
        // reads absurd (500%+). No plausible human reach → no claim.
        let ext = if profile.arm_length_m >= 0.4 {
            m.extension_frac
        } else {
            None
        };
        format!(
            "{{\"hand\":\"{}\",\"peak_speed\":{:.2},\"extension_frac\":{},\"guard_recovery_ms\":{},\"straightness\":{},\"shape\":{}}}",
            if hand == Hand::Left { "left" } else { "right" },
            m.peak_speed_mps,
            ext.map_or("null".into(), |v| format!("{v:.3}")),
            m.guard_recovery_ms.map_or("null".into(), |v| format!("{v:.0}")),
            m.straightness.map_or("null".into(), |v| format!("{v:.3}")),
            shape,
        )
    }

    pub fn has_profile(&self) -> bool {
        self.profile.is_some()
    }

    /// Live cue id for the most recent completed strike:
    /// `"hands_drop_after_punch"`, or `""` when clean or unmeasurable. Same
    /// thresholds as the session fault layer (`FaultThresholds` novice
    /// defaults, docs/05 stage 8); cue pacing and wording belong to the UI.
    ///
    /// Overextension is deliberately NOT cued here: the auto-profile derives
    /// arm length from the p95 of this session's own reach, so a full honest
    /// extension measures slightly over 1.0 by construction — cueing on it
    /// would be pseudo-precision (docs/03). It returns once profiles come
    /// from real calibration.
    pub fn last_strike_cue(&self) -> String {
        use boxingpro_core::faults::{FaultThresholds, HANDS_DROP_AFTER_PUNCH};
        let Some(profile) = &self.profile else {
            return String::new();
        };
        let Some((_, c)) = self.last_candidate() else {
            return String::new();
        };
        let th = FaultThresholds::default();
        let m = strike_metrics(&self.seq_f, c, profile, &MetricsConfig::default());
        match m.guard_recovery_ms {
            // None on a completed strike = never returned to guard within the
            // search window — the worst case, not missing data (faults.rs).
            Some(ms) if ms > th.guard_recovery_ms => return HANDS_DROP_AFTER_PUNCH.into(),
            None => return HANDS_DROP_AFTER_PUNCH.into(),
            Some(_) => {}
        }
        // Telegraph: hand dipped below guard in the pre-onset window
        // (content/faults/telegraph_hand_dip.yaml). Checked after the
        // defensive fault — one cue at a time, exposure first.
        {
            use boxingpro_core::telegraph::{detect, TelegraphConfig};
            if let Some(flags) = detect(&self.seq_f, c, profile, &TelegraphConfig::default()) {
                if flags.hand_dip {
                    return "telegraph_hand_dip".into();
                }
            }
        }
        String::new()
    }

    /// All completed strikes, chronological, as a JSON array. `t_ms` is
    /// relative to the session's first frame. Guard recovery is null until
    /// the profile locks; extension is omitted pending calibrated profiles
    /// (see `last_strike_cue`).
    pub fn strikes_json(&self) -> String {
        let t0 = self.seq_f.frames.first().map_or(0.0, |f| f.t_ms);
        let mut all: Vec<(Hand, &boxingpro_core::events::StrikeCandidate)> = Vec::new();
        for d in [&self.left, &self.right] {
            for c in d.candidates() {
                all.push((d.hand(), c));
            }
        }
        all.sort_by_key(|(_, c)| c.peak_idx);
        let items: Vec<String> = all
            .iter()
            .map(|(h, c)| {
                let rec = self.profile.as_ref().and_then(|p| {
                    strike_metrics(&self.seq_f, c, p, &MetricsConfig::default()).guard_recovery_ms
                });
                format!(
                    "{{\"t_ms\":{:.0},\"hand\":\"{}\",\"peak_speed\":{:.2},\"guard_recovery_ms\":{}}}",
                    self.seq_f.frames[c.peak_idx].t_ms - t0,
                    if *h == Hand::Left { "left" } else { "right" },
                    c.peak_speed_mps,
                    rec.map_or("null".to_string(), |v| format!("{v:.0}")),
                )
            })
            .collect();
        format!("[{}]", items.join(","))
    }

    /// Current guard state from the newest frame: `"both_high"`,
    /// `"lead_down"`, `"rear_down"`, `"both_down"`, or `""` when unprofiled
    /// or a wrist is unobserved. Flicker handling (punches drop the guard by
    /// definition for ~200ms) belongs to the caller.
    pub fn guard_state_now(&self) -> String {
        use boxingpro_core::guard::{guard_state_frame, GuardConfig, GuardState};
        let Some(p) = &self.profile else {
            return String::new();
        };
        let Some(f) = self.seq_f.frames.last() else {
            return String::new();
        };
        match guard_state_frame(f, p, &GuardConfig::default()) {
            Some(GuardState::BothHigh) => "both_high".into(),
            Some(GuardState::LeadDown) => "lead_down".into(),
            Some(GuardState::RearDown) => "rear_down".into(),
            Some(GuardState::BothDown) => "both_down".into(),
            None => String::new(),
        }
    }

    /// Serialize the session as a schema-valid SkeletonArchive v1 document
    /// (contracts/skeleton_archive.v1.schema.json), `t_ms` rebased to the
    /// first frame. Coordinate space is camera_metric (MediaPipe world
    /// landmarks are estimated meters); scale anchor stays "uncalibrated"
    /// until real calibration exists — downstream consumers gate on that.
    #[allow(clippy::too_many_arguments)]
    pub fn archive_json(
        &self,
        session_id: &str,
        profile_id: &str,
        pose_model_id: &str,
        device_model: &str,
        fps_nominal: f64,
        width: u32,
        height: u32,
    ) -> String {
        fn sanitize(s: &str) -> String {
            s.chars()
                .filter(|c| !c.is_control())
                .map(|c| if c == '"' || c == '\\' { '\'' } else { c })
                .collect()
        }
        let t0 = self.raw.t_ms.first().copied().unwrap_or(0.0);
        let mut frames = String::new();
        for i in 0..self.raw.len() {
            if i > 0 {
                frames.push(',');
            }
            frames.push_str(&format!(
                "{{\"t_ms\":{:.1},\"joints\":[",
                self.raw.t_ms[i] - t0
            ));
            for j in 0..JOINT_COUNT {
                if j > 0 {
                    frames.push(',');
                }
                let base = i * JOINT_COUNT * 4 + j * 4;
                let (x, y, z, c) = (
                    self.raw.data[base],
                    self.raw.data[base + 1],
                    self.raw.data[base + 2],
                    self.raw.data[base + 3],
                );
                if c > 0.0 {
                    let z = if z.is_finite() {
                        format!("{z:.4}")
                    } else {
                        "null".to_string()
                    };
                    frames.push_str(&format!(
                        "{{\"x\":{x:.4},\"y\":{y:.4},\"z\":{z},\"c\":{:.2}}}",
                        c.clamp(0.0, 1.0),
                    ));
                } else {
                    frames.push_str("null");
                }
            }
            frames.push_str("]}");
        }
        format!(
            "{{\"version\":1,\"session_id\":\"{}\",\"capture\":{{\"fps_nominal\":{fps_nominal},\"width\":{width},\"height\":{height},\"pose_model_id\":\"{}\",\"device_model\":\"{}\"}},\"calibration_ref\":{{\"body_profile_id\":\"{}\",\"scale_anchor\":\"uncalibrated\"}},\"coordinate_space\":\"camera_metric\",\"frames\":[{frames}]}}",
            sanitize(session_id),
            sanitize(pose_model_id),
            sanitize(device_model),
            sanitize(profile_id),
        )
    }

    /// Combos — bursts of ≥2 strikes with ≤600ms between apexes — as a JSON
    /// array of `{start_ms, n, avg_interval_ms}` (session-relative time).
    /// Pure cadence data via the core's assembler; punch classes stay
    /// unclassified until the trained classifier ships.
    pub fn combos_json(&self) -> String {
        use boxingpro_core::combos::assemble;
        use boxingpro_core::faults::StrikeRecord;
        use boxingpro_core::metrics::StrikeMetrics;
        use boxingpro_core::types::StrikeClass;
        let t0 = self.seq_f.frames.first().map_or(0.0, |f| f.t_ms);
        let mut recs: Vec<StrikeRecord> = [&self.left, &self.right]
            .into_iter()
            .flat_map(|d| d.candidates())
            .map(|c| StrikeRecord {
                t_apex_ms: self.seq_f.frames[c.peak_idx].t_ms,
                class: StrikeClass::Unclassified,
                metrics: StrikeMetrics {
                    peak_speed_mps: c.peak_speed_mps,
                    extension_frac: None,
                    straightness: None,
                    guard_recovery_ms: None,
                },
            })
            .collect();
        recs.sort_by(|a, b| a.t_apex_ms.partial_cmp(&b.t_apex_ms).unwrap());
        let combos = assemble(&recs, 600.0);
        let items: Vec<String> = combos
            .iter()
            .map(|c| {
                let avg = c.intervals_ms.iter().sum::<f64>() / c.intervals_ms.len() as f64;
                format!(
                    "{{\"start_ms\":{:.0},\"n\":{},\"avg_interval_ms\":{:.0}}}",
                    c.start_ms - t0,
                    c.classes.len(),
                    avg,
                )
            })
            .collect();
        format!("[{}]", items.join(","))
    }

    /// Whole-session summary as JSON: counts per hand, speed stats, average
    /// guard recovery. Deterministic Metrics Core numbers only; anything
    /// unobservable is `null` (honesty rule, docs/03).
    pub fn summary_json(&self) -> String {
        let dur_ms = match (self.seq_f.frames.first(), self.seq_f.frames.last()) {
            (Some(a), Some(b)) => b.t_ms - a.t_ms,
            _ => 0.0,
        };
        let mut speeds: Vec<f64> = Vec::new();
        let mut speeds_by_hand: [Vec<f64>; 2] = [Vec::new(), Vec::new()];
        let mut recoveries: Vec<f64> = Vec::new();
        for (hi, det) in [&self.left, &self.right].into_iter().enumerate() {
            for c in det.candidates() {
                speeds.push(c.peak_speed_mps);
                speeds_by_hand[hi].push(c.peak_speed_mps);
                if let Some(p) = &self.profile {
                    let m = strike_metrics(&self.seq_f, c, p, &MetricsConfig::default());
                    if let Some(r) = m.guard_recovery_ms {
                        recoveries.push(r);
                    }
                }
            }
        }
        let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
        let fmt_opt =
            |v: Option<f64>, prec: usize| v.map_or("null".into(), |x| format!("{x:.prec$}"));
        let avg_speed = (!speeds.is_empty()).then(|| mean(&speeds));
        let avg_left = (!speeds_by_hand[0].is_empty()).then(|| mean(&speeds_by_hand[0]));
        let avg_right = (!speeds_by_hand[1].is_empty()).then(|| mean(&speeds_by_hand[1]));
        let max_speed = speeds
            .iter()
            .cloned()
            .fold(None::<f64>, |m, s| Some(m.map_or(s, |m| m.max(s))));
        let avg_recovery = (!recoveries.is_empty()).then(|| mean(&recoveries));
        let per_min = (dur_ms > 1000.0).then(|| (speeds.len() as f64) / (dur_ms / 60_000.0));
        // Guard discipline: fraction of observed frames with both hands home.
        // Honesty gate: needs ≥300 observed frames (~5-10s) to be a claim.
        let guard_up = self.profile.as_ref().and_then(|p| {
            use boxingpro_core::guard::{guard_state_series, guard_up_fraction, GuardConfig};
            let series = guard_state_series(&self.seq_f, p, &GuardConfig::default());
            guard_up_fraction(&series, 300)
        });
        // Bounce rhythm from mid-hip height (core autocorrelation; None when
        // flat-footed / window too short — absence is the honest answer).
        let rhythm = {
            use boxingpro_core::rhythm::{analyze, RhythmConfig};
            use boxingpro_core::types::Joint;
            let samples: Vec<(f64, f64)> = self
                .seq_f
                .frames
                .iter()
                .filter_map(|f| {
                    let (l, r) = (f.get(Joint::LeftHip)?, f.get(Joint::RightHip)?);
                    Some((f.t_ms, (l.y + r.y) / 2.0))
                })
                .collect();
            analyze(&samples, &RhythmConfig::default())
        };
        let (cadence, predict) = match rhythm {
            Some(r) => (Some(r.cadence_hz), Some(r.predictability_index)),
            None => (None, None),
        };
        // Footwork: step count (ankle lift/land hysteresis) and stance width
        // vs a band from the profile's shoulder width. Cropped-feet sessions
        // honestly report nothing (min 300 observed both-ankle frames).
        let steps = {
            use boxingpro_core::footwork::{detect_steps, Foot, StepConfig};
            let c = StepConfig::default();
            detect_steps(&self.seq_f, Foot::Left, &c).len()
                + detect_steps(&self.seq_f, Foot::Right, &c).len()
        };
        let stance_w = self.profile.as_ref().and_then(|p| {
            use boxingpro_core::footwork::stance_integrity;
            let sw = p.shoulder_width_m;
            stance_integrity(&self.seq_f, 0.9 * sw, 1.9 * sw, 300)
        });
        format!(
            "{{\"duration_ms\":{:.0},\"strikes_left\":{},\"strikes_right\":{},\"avg_peak_speed\":{},\"avg_peak_speed_left\":{},\"avg_peak_speed_right\":{},\"max_peak_speed\":{},\"avg_guard_recovery_ms\":{},\"strikes_per_min\":{},\"guard_up_frac\":{},\"bounce_cadence_hz\":{},\"rhythm_predictability\":{},\"steps\":{},\"avg_stance_width_m\":{},\"stance_oob_frac\":{}}}",
            dur_ms,
            self.left.candidates().len(),
            self.right.candidates().len(),
            fmt_opt(avg_speed, 2),
            fmt_opt(avg_left, 2),
            fmt_opt(avg_right, 2),
            fmt_opt(max_speed, 2),
            fmt_opt(avg_recovery, 0),
            fmt_opt(per_min, 1),
            fmt_opt(guard_up, 3),
            fmt_opt(cadence, 2),
            fmt_opt(predict, 3),
            steps,
            fmt_opt(stance_w.map(|s| s.0), 3),
            fmt_opt(stance_w.map(|s| s.1), 3),
        )
    }
}

impl Default for SessionAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use boxingpro_core::synthetic::{jab_sequence, SyntheticJab};
    use boxingpro_core::types::JOINT_COUNT;

    /// Feed a synthetic sequence through the browser-facing flat-array API.
    fn analyzer_from(seq: &Sequence) -> SessionAnalyzer {
        let mut a = SessionAnalyzer::new();
        let mut buf = vec![0.0; JOINT_COUNT * 4];
        for f in &seq.frames {
            for (i, j) in f.joints.iter().enumerate() {
                let (x, y, z, c) = match j {
                    Some(k) => (k.x, k.y, k.z.unwrap_or(f64::NAN), k.confidence),
                    None => (0.0, 0.0, f64::NAN, 0.0),
                };
                buf[i * 4] = x;
                buf[i * 4 + 1] = y;
                buf[i * 4 + 2] = z;
                buf[i * 4 + 3] = c;
            }
            a.push_frame(f.t_ms, &buf);
        }
        a
    }

    // idle_ms 1200 gives the auto-profile a clean guard-only window (first
    // estimate lands at frame 60, ~1000ms) before the punch contaminates it —
    // the same reason the app tells users "calibrating — keep moving".
    #[test]
    fn clean_jab_yields_no_cue() {
        let jab = SyntheticJab {
            idle_ms: 1200.0,
            ..SyntheticJab::default()
        };
        let a = analyzer_from(&jab_sequence(1.8, &jab));
        assert_eq!(a.strike_count(), 1);
        assert!(a.has_profile(), "auto-profile must lock during idle frames");
        assert_eq!(a.last_strike_cue(), "");
    }

    #[test]
    fn slow_guard_return_yields_hands_drop_cue() {
        // Same punch-out, but the hand saunters back over 900ms: recovery
        // crosses the 550ms novice threshold.
        let jab = SyntheticJab {
            idle_ms: 1200.0,
            back_ms: 900.0,
            ..SyntheticJab::default()
        };
        let a = analyzer_from(&jab_sequence(1.8, &jab));
        assert_eq!(a.strike_count(), 1);
        assert_eq!(a.last_strike_cue(), "hands_drop_after_punch");
    }

    #[test]
    fn summary_counts_match_detectors() {
        let a = analyzer_from(&jab_sequence(1.8, &SyntheticJab::default()));
        let s = a.summary_json();
        assert!(s.contains("\"strikes_left\":1"), "{s}");
        assert!(s.contains("\"strikes_right\":0"), "{s}");
    }

    fn analyzer_with(seq: &Sequence, mc: f64, beta: f64) -> SessionAnalyzer {
        let mut a = SessionAnalyzer::new();
        a.filters = (0..JOINT_COUNT)
            .map(|_| {
                [
                    OneEuro::new(mc, beta),
                    OneEuro::new(mc, beta),
                    OneEuro::new(mc, beta),
                ]
            })
            .collect();
        let mut buf = vec![0.0; JOINT_COUNT * 4];
        for f in &seq.frames {
            for (i, j) in f.joints.iter().enumerate() {
                let (x, y, z, c) = match j {
                    Some(k) => (k.x, k.y, k.z.unwrap_or(f64::NAN), k.confidence),
                    None => (0.0, 0.0, f64::NAN, 0.0),
                };
                buf[i * 4] = x;
                buf[i * 4 + 1] = y;
                buf[i * 4 + 2] = z;
                buf[i * 4 + 3] = c;
            }
            a.push_frame(f.t_ms, &buf);
        }
        a
    }

    /// Semicircular hook-like arc at punch speed, guard-idle bookends.
    fn arc_sequence() -> Sequence {
        use boxingpro_core::synthetic::standing_frame;
        use boxingpro_core::types::{Joint, Keypoint};
        let mut seq = Sequence::default();
        let dt = 1000.0 / 60.0;
        let guard = [-0.16, 1.55];
        let (n_idle, n_arc) = (75, 10);
        for i in 0..(n_idle + n_arc + 60) {
            let t = i as f64 * dt;
            let mut f = standing_frame(t, 1.8);
            let wrist = if i < n_idle {
                guard
            } else if i < n_idle + n_arc {
                let p = (i - n_idle) as f64 / n_arc as f64;
                let ang = core::f64::consts::PI * (1.0 - p);
                [
                    guard[0] + 0.25 + 0.25 * ang.cos(),
                    guard[1] + 0.25 * ang.sin(),
                ]
            } else {
                [guard[0] + 0.5, guard[1]]
            };
            f.set(
                Joint::LeftWrist,
                Keypoint {
                    x: wrist[0],
                    y: wrist[1],
                    z: None,
                    confidence: 1.0,
                },
            );
            seq.frames.push(f);
        }
        seq
    }

    #[test]
    #[ignore] // param-sweep probe; run with --ignored --nocapture when tuning
    fn probe_filter_params() {
        let jab = SyntheticJab {
            idle_ms: 1200.0,
            ..SyntheticJab::default()
        };
        let jab_seq = jab_sequence(1.8, &jab);
        let noisy = jitter(&jab_seq, 0.07);
        let arc = arc_sequence();
        let truth = jab.expected_peak_speed_mps();
        for (mc, beta) in [
            (1.0, 0.3),
            (1.0, 1.0),
            (1.5, 1.5),
            (1.0, 2.0),
            (1.0, 3.0),
            (1.0, 5.0),
        ] {
            let a = analyzer_with(&jab_seq, mc, beta);
            let n = analyzer_with(&noisy, mc, beta);
            let c = analyzer_with(&arc, mc, beta);
            println!(
                "mc={mc} beta={beta}: jab={} | noisy_count={} | arc_count={} arc={}",
                a.last_strike_json(),
                n.strike_count(),
                c.strike_count(),
                c.last_strike_json(),
            );
            println!("   (jab truth peak {truth:.2} m/s)");
        }
    }

    #[test]
    fn pre_punch_hand_dip_yields_telegraph_cue() {
        // Clean jab, but the wrist sags 10cm below guard for the 300ms before
        // launch — the classic wind-up tell.
        use boxingpro_core::types::{Joint, Keypoint};
        let jab = SyntheticJab {
            idle_ms: 1200.0,
            ..SyntheticJab::default()
        };
        let mut seq = jab_sequence(1.8, &jab);
        let dip_start = jab.idle_ms - 300.0;
        for f in &mut seq.frames {
            if f.t_ms >= dip_start && f.t_ms < jab.idle_ms {
                if let Some(w) = f.get(Joint::LeftWrist) {
                    let dipped = Keypoint { y: w.y - 0.10, ..w };
                    f.set(Joint::LeftWrist, dipped);
                }
            }
        }
        let a = analyzer_from(&seq);
        assert_eq!(a.strike_count(), 1);
        assert_eq!(a.last_strike_cue(), "telegraph_hand_dip");
    }

    #[test]
    fn rapid_triple_jab_reads_as_one_combo() {
        // Three jabs ~430ms apart (idle 100ms): apex gaps < 600ms chain them.
        let jab = SyntheticJab {
            idle_ms: 100.0,
            ..SyntheticJab::default()
        };
        let one = jab_sequence(1.8, &jab);
        let span = one.frames.last().unwrap().t_ms + 1000.0 / jab.fps;
        let mut seq = Sequence::default();
        for rep in 0..3 {
            for f in &one.frames {
                let mut f = f.clone();
                f.t_ms += rep as f64 * span;
                seq.frames.push(f);
            }
        }
        let a = analyzer_from(&seq);
        assert_eq!(a.strike_count(), 3);
        let combos = a.combos_json();
        assert!(combos.contains("\"n\":3"), "{combos}");
    }

    #[test]
    fn frame_cap_stops_growth_and_reports_full() {
        let mut a = SessionAnalyzer::new();
        let buf = vec![0.0; JOINT_COUNT * 4]; // all-unobserved frames: cheap
        for i in 0..(MAX_SESSION_FRAMES + 500) {
            a.push_frame(i as f64 * 16.6, &buf);
        }
        assert_eq!(a.frame_count(), MAX_SESSION_FRAMES);
        assert!(a.is_full());
    }

    #[test]
    fn straight_jab_reads_shape_straight_and_arc_reads_curved() {
        // Straight jab → shape "straight".
        let jab = SyntheticJab {
            idle_ms: 1200.0,
            ..SyntheticJab::default()
        };
        let a = analyzer_from(&jab_sequence(1.8, &jab));
        assert!(
            a.last_strike_json().contains("\"shape\":\"straight\""),
            "{}",
            a.last_strike_json()
        );

        // Semicircular hook-like arc → "curved".
        let b = analyzer_from(&arc_sequence());
        assert_eq!(b.strike_count(), 1, "arc must register as one strike");
        assert!(
            b.last_strike_json().contains("\"shape\":\"curved\""),
            "{}",
            b.last_strike_json()
        );
    }

    /// Deterministic per-(frame, joint, axis) pseudo-noise in [-amp, amp].
    fn jitter(seq: &Sequence, amp: f64) -> Sequence {
        let mut out = seq.clone();
        for (fi, f) in out.frames.iter_mut().enumerate() {
            for (ji, j) in f.joints.iter_mut().enumerate() {
                if let Some(k) = j {
                    // splitmix64 — decorrelated across frames, unlike a
                    // linear hash whose sawtooth central-difference ignores.
                    let h = |ax: usize| {
                        let mut z = (fi as u64)
                            .wrapping_mul(0x9E37_79B9_7F4A_7C15)
                            .wrapping_add(ji as u64 * 0x0100_0000_01B3)
                            .wrapping_add(ax as u64);
                        z ^= z >> 30;
                        z = z.wrapping_mul(0xBF58_476D_1CE4_E5B9);
                        z ^= z >> 27;
                        z = z.wrapping_mul(0x94D0_49BB_1331_11EB);
                        z ^= z >> 31;
                        ((z % 10000) as f64 / 10000.0 - 0.5) * 2.0 * amp
                    };
                    k.x += h(0);
                    k.y += h(1);
                }
            }
        }
        out
    }

    #[test]
    fn one_euro_filtering_kills_jitter_false_positives() {
        // ±70mm landmark jitter — a bad-lighting worst case for phone world
        // landmarks (±35mm typical peaks at ~3 m/s, right at the detector's
        // min-peak gate) — must not create phantom strikes. The raw path must
        // actually be fooled at this amplitude (otherwise this test proves
        // nothing), and the filtered analyzer must still count only the jab.
        let jab = SyntheticJab {
            idle_ms: 1200.0,
            ..SyntheticJab::default()
        };
        let noisy = jitter(&jab_sequence(1.8, &jab), 0.07);

        let cfg = DetectorConfig::default();
        let raw_count = boxingpro_core::events::detect_strikes(&noisy, Hand::Left, &cfg).len()
            + boxingpro_core::events::detect_strikes(&noisy, Hand::Right, &cfg).len();
        assert!(
            raw_count > 1,
            "noise amplitude too low to fool the raw path (got {raw_count}); raise it"
        );

        let a = analyzer_from(&noisy);
        assert_eq!(a.strike_count(), 1, "filtered path must count only the jab");
    }

    #[test]
    fn declared_stance_survives_profile_refresh() {
        // Profile refreshes every 300 frames; a declared southpaw stance must
        // not be clobbered back to orthodox by the refresh.
        let jab = SyntheticJab {
            idle_ms: 3000.0, // total ≈ 374 frames → at least one 300-frame refresh
            ..SyntheticJab::default()
        };
        let seq = jab_sequence(1.8, &jab);
        let mut a = SessionAnalyzer::new();
        a.set_stance("southpaw");
        let mut buf = vec![0.0; JOINT_COUNT * 4];
        for f in &seq.frames {
            for (i, j) in f.joints.iter().enumerate() {
                let (x, y, z, c) = match j {
                    Some(k) => (k.x, k.y, k.z.unwrap_or(f64::NAN), k.confidence),
                    None => (0.0, 0.0, f64::NAN, 0.0),
                };
                buf[i * 4] = x;
                buf[i * 4 + 1] = y;
                buf[i * 4 + 2] = z;
                buf[i * 4 + 3] = c;
            }
            a.push_frame(f.t_ms, &buf);
        }
        assert!(a.frame_count() > 300, "must cross a refresh boundary");
        assert!(a.has_profile());
        assert_eq!(a.stance(), "southpaw");
        // Lead hand for a southpaw is the right; the left jab in this
        // synthetic is therefore the REAR hand — guard math must still work.
        assert_eq!(a.guard_state_now(), "both_high");
    }

    #[test]
    fn guard_state_and_summary_fraction_report_hands_home() {
        // Long idle bookends: >300 observed frames so the honesty gate opens.
        let jab = SyntheticJab {
            idle_ms: 3000.0,
            ..SyntheticJab::default()
        };
        let a = analyzer_from(&jab_sequence(1.8, &jab));
        assert_eq!(a.guard_state_now(), "both_high");
        let s = a.summary_json();
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        let frac = v["guard_up_frac"].as_f64().expect("gate open");
        assert!(frac > 0.8, "mostly at guard, got {frac}");
        // Footwork on a planted synthetic: zero steps, stance width ≈ ankle
        // separation (0.12 × height), gate open (>300 both-ankle frames).
        assert_eq!(v["steps"], 0);
        let w = v["avg_stance_width_m"].as_f64().expect("ankles visible");
        assert!((w - 0.12 * 1.8).abs() < 0.02, "stance width {w}");
    }

    #[test]
    fn archive_json_is_valid_and_structurally_sound() {
        let seq = jab_sequence(1.8, &SyntheticJab::default());
        let a = analyzer_from(&seq);
        let s = a.archive_json(
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
            "mediapipe-pose-landmarker-full@tasks-vision",
            "test \"device\" \\ ua",
            60.0,
            1280,
            720,
        );
        let v: serde_json::Value = serde_json::from_str(&s).expect("valid JSON");
        assert_eq!(v["version"], 1);
        assert_eq!(v["coordinate_space"], "camera_metric");
        assert_eq!(v["calibration_ref"]["scale_anchor"], "uncalibrated");
        let frames = v["frames"].as_array().unwrap();
        assert_eq!(frames.len(), seq.frames.len());
        assert_eq!(frames[0]["joints"].as_array().unwrap().len(), 21);
        assert_eq!(frames[0]["t_ms"], 0.0);
        // Sanitizer must keep injected quotes/backslashes out of the JSON.
        assert!(v["capture"]["device_model"]
            .as_str()
            .unwrap()
            .contains("'device'"));
    }

    #[test]
    fn strike_log_lists_the_jab_with_session_relative_time() {
        let jab = SyntheticJab {
            idle_ms: 1200.0,
            ..SyntheticJab::default()
        };
        let a = analyzer_from(&jab_sequence(1.8, &jab));
        let log = a.strikes_json();
        assert!(
            log.starts_with('[') && log.contains("\"hand\":\"left\""),
            "{log}"
        );
        // Peak lands during the out phase: idle_ms..idle_ms+out_ms window.
        let t: f64 = log
            .split("\"t_ms\":")
            .nth(1)
            .and_then(|s| s.split(',').next())
            .and_then(|s| s.parse().ok())
            .unwrap();
        assert!(
            t >= jab.idle_ms && t <= jab.idle_ms + jab.out_ms + 50.0,
            "peak t {t}"
        );
    }
}
