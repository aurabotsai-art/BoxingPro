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
        // Auto-profile: first estimate as soon as possible (every 60 frames
        // until one sticks), then keep refining every 300 frames — the guard
        // median converges as guard-position frames dominate the session,
        // washing out contamination from punches thrown during the first
        // seconds.
        let n = self.seq.frames.len();
        if (self.profile.is_none() && n.is_multiple_of(60)) || n.is_multiple_of(300) {
            if let Some(p) = auto_profile_from(&self.seq) {
                self.profile = Some(p);
            }
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
        let m = strike_metrics(&self.seq, c, profile, &MetricsConfig::default());
        match m.guard_recovery_ms {
            // None on a completed strike = never returned to guard within the
            // search window — the worst case, not missing data (faults.rs).
            Some(ms) if ms > th.guard_recovery_ms => HANDS_DROP_AFTER_PUNCH.into(),
            None => HANDS_DROP_AFTER_PUNCH.into(),
            Some(_) => String::new(),
        }
    }

    /// All completed strikes, chronological, as a JSON array. `t_ms` is
    /// relative to the session's first frame. Guard recovery is null until
    /// the profile locks; extension is omitted pending calibrated profiles
    /// (see `last_strike_cue`).
    pub fn strikes_json(&self) -> String {
        let t0 = self.seq.frames.first().map_or(0.0, |f| f.t_ms);
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
                    strike_metrics(&self.seq, c, p, &MetricsConfig::default()).guard_recovery_ms
                });
                format!(
                    "{{\"t_ms\":{:.0},\"hand\":\"{}\",\"peak_speed\":{:.2},\"guard_recovery_ms\":{}}}",
                    self.seq.frames[c.peak_idx].t_ms - t0,
                    if *h == Hand::Left { "left" } else { "right" },
                    c.peak_speed_mps,
                    rec.map_or("null".to_string(), |v| format!("{v:.0}")),
                )
            })
            .collect();
        format!("[{}]", items.join(","))
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
