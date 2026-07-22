//! Guard-state sampling (docs/05-PERCEPTION-PIPELINE.md stage 5).
//!
//! Continuous classification of hand positions relative to the calibrated
//! guard. Feeds live "hands up" coaching, the guard_low_at_rest fault family,
//! and exposure metrics. Unobserved wrists → None sample, never a guess.

use crate::events::Hand;
use crate::types::{BodyProfile, Joint, PoseFrame, Sequence, Stance};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuardState {
    BothHigh,
    LeadDown,
    RearDown,
    BothDown,
}

#[derive(Debug, Clone)]
pub struct GuardConfig {
    /// Wrist within this distance of its calibrated guard point counts "home".
    pub radius_m: f64,
}

impl Default for GuardConfig {
    fn default() -> Self {
        GuardConfig { radius_m: 0.15 }
    }
}

fn wrist_home(frame: &PoseFrame, wrist: Joint, guard: [f64; 2], radius: f64) -> Option<bool> {
    let w = frame.get(wrist)?;
    Some(((w.x - guard[0]).powi(2) + (w.y - guard[1]).powi(2)).sqrt() <= radius)
}

/// Per-frame guard state. None where either wrist is unobserved.
pub fn guard_state_series(
    seq: &Sequence,
    profile: &BodyProfile,
    cfg: &GuardConfig,
) -> Vec<Option<GuardState>> {
    let (lead_wrist, lead_guard, rear_wrist, rear_guard) = match profile.stance {
        Stance::Orthodox => (
            Hand::Left.wrist(),
            profile.guard_left,
            Hand::Right.wrist(),
            profile.guard_right,
        ),
        Stance::Southpaw => (
            Hand::Right.wrist(),
            profile.guard_right,
            Hand::Left.wrist(),
            profile.guard_left,
        ),
    };
    seq.frames
        .iter()
        .map(|f| {
            let lead = wrist_home(f, lead_wrist, lead_guard, cfg.radius_m)?;
            let rear = wrist_home(f, rear_wrist, rear_guard, cfg.radius_m)?;
            Some(match (lead, rear) {
                (true, true) => GuardState::BothHigh,
                (false, true) => GuardState::LeadDown,
                (true, false) => GuardState::RearDown,
                (false, false) => GuardState::BothDown,
            })
        })
        .collect()
}

/// Fraction of observed frames with both hands home. None below
/// `min_observed` observed frames (the honesty gate).
pub fn guard_up_fraction(series: &[Option<GuardState>], min_observed: usize) -> Option<f64> {
    let observed: Vec<GuardState> = series.iter().flatten().copied().collect();
    if observed.len() < min_observed {
        return None;
    }
    Some(
        observed
            .iter()
            .filter(|s| **s == GuardState::BothHigh)
            .count() as f64
            / observed.len() as f64,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synthetic::{profile, standing_frame};
    use crate::types::Keypoint;

    fn seq_with_wrists(left: [f64; 2], right: [f64; 2], n: usize) -> Sequence {
        let frames = (0..n)
            .map(|i| {
                let mut f = standing_frame(i as f64 * 16.6, 1.8);
                f.set(
                    Joint::LeftWrist,
                    Keypoint {
                        x: left[0],
                        y: left[1],
                        z: None,
                        confidence: 1.0,
                    },
                );
                f.set(
                    Joint::RightWrist,
                    Keypoint {
                        x: right[0],
                        y: right[1],
                        z: None,
                        confidence: 1.0,
                    },
                );
                f
            })
            .collect();
        Sequence { frames }
    }

    #[test]
    fn hands_at_guard_read_both_high() {
        let p = profile(1.8);
        let seq = seq_with_wrists(p.guard_left, p.guard_right, 60);
        let s = guard_state_series(&seq, &p, &GuardConfig::default());
        assert!(s.iter().all(|x| *x == Some(GuardState::BothHigh)));
        assert_eq!(guard_up_fraction(&s, 30), Some(1.0));
    }

    #[test]
    fn dropped_lead_reads_lead_down_orthodox() {
        let p = profile(1.8); // orthodox → left is lead
        let seq = seq_with_wrists([p.guard_left[0], p.guard_left[1] - 0.4], p.guard_right, 60);
        let s = guard_state_series(&seq, &p, &GuardConfig::default());
        assert!(s.iter().all(|x| *x == Some(GuardState::LeadDown)));
    }

    #[test]
    fn unobserved_wrist_yields_none_and_gates_summary() {
        let p = profile(1.8);
        let mut seq = seq_with_wrists(p.guard_left, p.guard_right, 20);
        for f in &mut seq.frames {
            f.joints[Joint::LeftWrist as usize] = None;
        }
        let s = guard_state_series(&seq, &p, &GuardConfig::default());
        assert!(s.iter().all(Option::is_none));
        assert_eq!(guard_up_fraction(&s, 10), None, "no data → no claim");
    }
}
