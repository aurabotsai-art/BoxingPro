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
use boxingpro_core::metrics::{strike_metrics, MetricsConfig};
use boxingpro_core::types::{BodyProfile, Keypoint, PoseFrame, Sequence, Stance, JOINT_COUNT};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct SessionAnalyzer {
    seq: Sequence,
    profile: Option<BodyProfile>,
    left: LiveDetector,
    right: LiveDetector,
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

#[wasm_bindgen]
impl SessionAnalyzer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SessionAnalyzer {
        let cfg = DetectorConfig::default();
        SessionAnalyzer {
            seq: Sequence::default(),
            profile: None,
            left: LiveDetector::new(Hand::Left, cfg.clone()),
            right: LiveDetector::new(Hand::Right, cfg),
        }
    }

    /// Push one frame. `joints` must be 21×4 (x, y, z, confidence); z=NaN
    /// when unknown. Coordinates in meters (MediaPipe world landmarks).
    pub fn push_frame(&mut self, t_ms: f64, joints: &[f64]) {
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
        self.seq.frames.push(pf);
        self.left.advance(&self.seq);
        self.right.advance(&self.seq);
        // Refresh the auto-profile periodically until it locks in.
        if self.profile.is_none() && self.seq.frames.len().is_multiple_of(60) {
            self.profile = auto_profile_from(&self.seq);
        }
    }

    pub fn frame_count(&self) -> usize {
        self.seq.frames.len()
    }

    /// Live strike count across both hands. O(1): the incremental detectors
    /// (batch-equivalent, see core pipeline tests) maintain it per frame.
    pub fn strike_count(&self) -> usize {
        self.left.candidates().len() + self.right.candidates().len()
    }

    /// JSON summary of the most recent strike (speed, extension, guard
    /// recovery) or `null` if none/unprofiled. Numbers via the same Metrics
    /// Core code paths as every other tier.
    pub fn last_strike_json(&self) -> String {
        let profile = match &self.profile {
            Some(p) => p,
            None => return "null".into(),
        };
        let Some((hand, c)) = [&self.left, &self.right]
            .into_iter()
            .filter_map(|d| d.candidates().last().map(|c| (d.hand(), c)))
            .max_by(|a, b| a.1.peak_idx.cmp(&b.1.peak_idx))
        else {
            return "null".into();
        };
        let m = strike_metrics(&self.seq, c, profile, &MetricsConfig::default());
        format!(
            "{{\"hand\":\"{}\",\"peak_speed\":{:.2},\"extension_frac\":{},\"guard_recovery_ms\":{}}}",
            if hand == Hand::Left { "left" } else { "right" },
            m.peak_speed_mps,
            m.extension_frac.map_or("null".into(), |v| format!("{v:.3}")),
            m.guard_recovery_ms.map_or("null".into(), |v| format!("{v:.0}")),
        )
    }

    pub fn has_profile(&self) -> bool {
        self.profile.is_some()
    }

    /// Whole-session summary as JSON: counts per hand, speed stats, average
    /// guard recovery. Deterministic Metrics Core numbers only; anything
    /// unobservable is `null` (honesty rule, docs/03).
    pub fn summary_json(&self) -> String {
        let dur_ms = match (self.seq.frames.first(), self.seq.frames.last()) {
            (Some(a), Some(b)) => b.t_ms - a.t_ms,
            _ => 0.0,
        };
        let mut speeds: Vec<f64> = Vec::new();
        let mut recoveries: Vec<f64> = Vec::new();
        for det in [&self.left, &self.right] {
            for c in det.candidates() {
                speeds.push(c.peak_speed_mps);
                if let Some(p) = &self.profile {
                    let m = strike_metrics(&self.seq, c, p, &MetricsConfig::default());
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
        let max_speed = speeds
            .iter()
            .cloned()
            .fold(None::<f64>, |m, s| Some(m.map_or(s, |m| m.max(s))));
        let avg_recovery = (!recoveries.is_empty()).then(|| mean(&recoveries));
        let per_min = (dur_ms > 1000.0).then(|| (speeds.len() as f64) / (dur_ms / 60_000.0));
        format!(
            "{{\"duration_ms\":{:.0},\"strikes_left\":{},\"strikes_right\":{},\"avg_peak_speed\":{},\"max_peak_speed\":{},\"avg_guard_recovery_ms\":{},\"strikes_per_min\":{}}}",
            dur_ms,
            self.left.candidates().len(),
            self.right.candidates().len(),
            fmt_opt(avg_speed, 2),
            fmt_opt(max_speed, 2),
            fmt_opt(avg_recovery, 0),
            fmt_opt(per_min, 1),
        )
    }
}

impl Default for SessionAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}
