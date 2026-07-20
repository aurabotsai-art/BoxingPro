//! Footwork analysis (docs/05-PERCEPTION-PIPELINE.md stages 5+7).
//!
//! Step events from ankle kinematics plus continuous stance tracks.
//! Coordinate expectation: metric space, y up, floor near y=0 after
//! normalization (docs/05 stage 4).

use crate::types::{Joint, Sequence};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Foot {
    Left,
    Right,
}

impl Foot {
    pub fn ankle(self) -> Joint {
        match self {
            Foot::Left => Joint::LeftAnkle,
            Foot::Right => Joint::RightAnkle,
        }
    }
}

/// One detected step: lift-off → landing of a single foot.
#[derive(Debug, Clone)]
pub struct StepEvent {
    pub foot: Foot,
    pub lift_idx: usize,
    pub land_idx: usize,
    /// Horizontal travel between lift-off and landing, meters.
    pub travel_m: f64,
    pub duration_ms: f64,
}

#[derive(Debug, Clone)]
pub struct StepConfig {
    /// Ankle rise above its rolling baseline that opens a step.
    pub lift_threshold_m: f64,
    /// Ankle height above baseline below which the step closes (hysteresis).
    pub land_threshold_m: f64,
    /// Steps shorter than this are jitter, not footwork.
    pub min_duration_ms: f64,
    /// Frames used to establish the per-foot ground baseline.
    pub baseline_frames: usize,
}

impl Default for StepConfig {
    fn default() -> Self {
        StepConfig {
            lift_threshold_m: 0.05,
            land_threshold_m: 0.03,
            min_duration_ms: 80.0,
            baseline_frames: 30,
        }
    }
}

/// Detect steps for one foot. The ground baseline is the minimum observed
/// ankle height over the first `baseline_frames` observed frames — robust to
/// users who start mid-bounce, and deliberately NOT adaptive during the
/// sequence (a fighter who never plants shouldn't silently re-zero the floor).
pub fn detect_steps(seq: &Sequence, foot: Foot, cfg: &StepConfig) -> Vec<StepEvent> {
    let ankle = foot.ankle();
    let mut baseline: Option<f64> = None;
    let mut seen = 0usize;
    for f in &seq.frames {
        if let Some(k) = f.get(ankle) {
            baseline = Some(baseline.map_or(k.y, |b: f64| b.min(k.y)));
            seen += 1;
            if seen >= cfg.baseline_frames {
                break;
            }
        }
    }
    let baseline = match baseline {
        Some(b) => b,
        None => return Vec::new(), // ankle never observed → no fabrication
    };

    let mut out = Vec::new();
    let mut open: Option<(usize, f64, f64)> = None; // (lift_idx, lift_x, lift_t)
    for (i, f) in seq.frames.iter().enumerate() {
        let k = match f.get(ankle) {
            Some(k) => k,
            None => continue,
        };
        let h = k.y - baseline;
        match open {
            None => {
                if h > cfg.lift_threshold_m {
                    open = Some((i, k.x, f.t_ms));
                }
            }
            Some((lift_idx, lift_x, lift_t)) => {
                if h < cfg.land_threshold_m {
                    let dur = f.t_ms - lift_t;
                    if dur >= cfg.min_duration_ms {
                        out.push(StepEvent {
                            foot,
                            lift_idx,
                            land_idx: i,
                            travel_m: (k.x - lift_x).abs(),
                            duration_ms: dur,
                        });
                    }
                    open = None;
                }
            }
        }
    }
    out
}

/// Continuous stance-width track (horizontal ankle separation, meters).
/// `None` for frames where either ankle is unobserved.
pub fn stance_width_series(seq: &Sequence) -> Vec<Option<f64>> {
    seq.frames
        .iter()
        .map(
            |f| match (f.get(Joint::LeftAnkle), f.get(Joint::RightAnkle)) {
                (Some(l), Some(r)) => Some((l.x - r.x).abs()),
                _ => None,
            },
        )
        .collect()
}

/// Summary of stance integrity over a sequence: mean width and the fraction
/// of observed frames where width left the [min,max] band (e.g. the user's
/// calibrated stance ±20%). Returns `None` if fewer than `min_observed`
/// frames had both ankles visible — cropped-feet sessions must not produce
/// confident stance claims (docs/03 §1).
pub fn stance_integrity(
    seq: &Sequence,
    band_min_m: f64,
    band_max_m: f64,
    min_observed: usize,
) -> Option<(f64, f64)> {
    let widths: Vec<f64> = stance_width_series(seq).into_iter().flatten().collect();
    if widths.len() < min_observed {
        return None;
    }
    let mean = widths.iter().sum::<f64>() / widths.len() as f64;
    let out_of_band = widths
        .iter()
        .filter(|w| **w < band_min_m || **w > band_max_m)
        .count() as f64
        / widths.len() as f64;
    Some((mean, out_of_band))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synthetic::standing_frame;
    use crate::types::{Keypoint, Sequence};

    fn kp(x: f64, y: f64) -> Keypoint {
        Keypoint {
            x,
            y,
            z: None,
            confidence: 1.0,
        }
    }

    /// 60fps sequence: stand 0.5s, left foot steps 0.3 m forward over 250 ms
    /// (lift → travel → plant), stand 0.5s.
    fn step_sequence() -> Sequence {
        let dt = 1000.0 / 60.0;
        let mut frames = Vec::new();
        let total_ms = 1250.0;
        let (step_start, step_dur) = (500.0, 250.0);
        let n = (total_ms / dt) as usize;
        for i in 0..=n {
            let t = i as f64 * dt;
            let mut f = standing_frame(t, 1.8);
            let p = ((t - step_start) / step_dur).clamp(0.0, 1.0);
            if p > 0.0 {
                // Parabolic lift peaking mid-step at 8 cm; forward travel 0.3 m.
                let base = standing_frame(0.0, 1.8).get(Joint::LeftAnkle).unwrap();
                let lift = 0.08 * 4.0 * p * (1.0 - p);
                f.set(Joint::LeftAnkle, kp(base.x + 0.3 * p, base.y + lift));
            }
            frames.push(f);
        }
        Sequence { frames }
    }

    #[test]
    fn detects_one_step_with_correct_travel() {
        let seq = step_sequence();
        let left = detect_steps(&seq, Foot::Left, &StepConfig::default());
        let right = detect_steps(&seq, Foot::Right, &StepConfig::default());
        assert_eq!(left.len(), 1, "exactly one left step");
        assert!(right.is_empty(), "planted right foot must not step");
        let s = &left[0];
        // Travel measured between threshold crossings, so somewhat under 0.3 m.
        assert!(
            s.travel_m > 0.15 && s.travel_m < 0.31,
            "travel {}",
            s.travel_m
        );
        assert!(
            s.duration_ms > 80.0 && s.duration_ms < 300.0,
            "duration {}",
            s.duration_ms
        );
    }

    #[test]
    fn standing_still_produces_no_steps() {
        let dt = 1000.0 / 60.0;
        let frames = (0..120)
            .map(|i| standing_frame(i as f64 * dt, 1.8))
            .collect();
        let seq = Sequence { frames };
        assert!(detect_steps(&seq, Foot::Left, &StepConfig::default()).is_empty());
    }

    #[test]
    fn stance_integrity_refuses_cropped_feet() {
        let dt = 1000.0 / 60.0;
        let mut frames: Vec<_> = (0..120)
            .map(|i| standing_frame(i as f64 * dt, 1.8))
            .collect();
        for f in &mut frames {
            f.joints[Joint::LeftAnkle as usize] = None; // feet out of frame
        }
        let seq = Sequence { frames };
        assert!(
            stance_integrity(&seq, 0.1, 0.4, 30).is_none(),
            "cropped feet → no stance claims"
        );
    }
}
