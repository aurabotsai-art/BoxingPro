//! Browser API for the Metrics Core (docs/04 §4, Tier-1 path).
//!
//! JS pushes canonical-skeleton frames as flat arrays; this wrapper keeps the
//! session sequence and answers live queries (strike count, last-strike
//! metrics) plus a full end-of-session analysis. Same crate, same numbers as
//! the CLI and future server workers.
//!
//! Frame layout: `[x0, y0, c0, x1, y1, c1, …]` for the 21 canonical joints
//! (core/src/types.rs order). Unobserved joint = confidence 0 (x/y ignored).

use boxingpro_core::events::{detect_strikes, DetectorConfig, Hand};
use boxingpro_core::metrics::{strike_metrics, MetricsConfig};
use boxingpro_core::types::{BodyProfile, Keypoint, PoseFrame, Sequence, Stance, JOINT_COUNT};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct SessionAnalyzer {
    seq: Sequence,
    profile: Option<BodyProfile>,
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
                reach.push(((w.x - s.x).powi(2) + (w.y - s.y).powi(2)).sqrt());
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
        SessionAnalyzer {
            seq: Sequence::default(),
            profile: None,
        }
    }

    /// Push one frame. `joints` must be 21×3 (x, y, confidence).
    pub fn push_frame(&mut self, t_ms: f64, joints: &[f64]) {
        let mut pf = PoseFrame::empty(t_ms);
        for i in 0..JOINT_COUNT.min(joints.len() / 3) {
            let (x, y, c) = (joints[i * 3], joints[i * 3 + 1], joints[i * 3 + 2]);
            if c > 0.0 {
                pf.joints[i] = Some(Keypoint {
                    x,
                    y,
                    z: None,
                    confidence: c,
                });
            }
        }
        self.seq.frames.push(pf);
        // Refresh the auto-profile periodically until it locks in.
        if self.profile.is_none() && self.seq.frames.len().is_multiple_of(60) {
            self.profile = auto_profile_from(&self.seq);
        }
    }

    pub fn frame_count(&self) -> usize {
        self.seq.frames.len()
    }

    /// Live strike count across both hands (recomputed on call; cheap at
    /// session scale, incremental version lands with the Tier-1 optimizer).
    pub fn strike_count(&self) -> usize {
        let cfg = DetectorConfig::default();
        detect_strikes(&self.seq, Hand::Left, &cfg).len()
            + detect_strikes(&self.seq, Hand::Right, &cfg).len()
    }

    /// JSON summary of the most recent strike (speed, extension, guard
    /// recovery) or `null` if none/unprofiled. Numbers via the same Metrics
    /// Core code paths as every other tier.
    pub fn last_strike_json(&self) -> String {
        let profile = match &self.profile {
            Some(p) => p,
            None => return "null".into(),
        };
        let cfg = DetectorConfig::default();
        let mut all: Vec<(Hand, boxingpro_core::events::StrikeCandidate)> = Vec::new();
        for hand in [Hand::Left, Hand::Right] {
            for c in detect_strikes(&self.seq, hand, &cfg) {
                all.push((hand, c));
            }
        }
        let Some((hand, c)) = all
            .into_iter()
            .max_by(|a, b| a.1.peak_idx.cmp(&b.1.peak_idx))
        else {
            return "null".into();
        };
        let m = strike_metrics(&self.seq, &c, profile, &MetricsConfig::default());
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
}

impl Default for SessionAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}
