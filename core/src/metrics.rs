//! Per-strike metrics (docs/05-PERCEPTION-PIPELINE.md stage 7).
//!
//! Deterministic functions over (sequence, strike candidate, body profile).
//! Every metric is Option-valued: unobservable → None, per the honesty rule.

use crate::events::{Hand, StrikeCandidate};
use crate::types::{BodyProfile, Joint, Sequence, Stance};

/// Metrics for a single detected strike. Tiers per docs/03-FEASIBILITY.md §5.
#[derive(Debug, Clone)]
pub struct StrikeMetrics {
    /// T1: peak wrist speed, m/s (central-difference over smoothed track).
    pub peak_speed_mps: f64,
    /// T0: max wrist-to-same-shoulder distance during the strike as a
    /// fraction of calibrated arm length. >1.02 flags overextension.
    pub extension_frac: Option<f64>,
    /// T0/T1: path straightness = chord / path length in [0,1].
    /// 1.0 is a perfectly straight punch; hooks legitimately score low —
    /// interpretation is class-dependent and belongs to the fault layer.
    pub straightness: Option<f64>,
    /// T0: ms from peak extension until the wrist returns within
    /// `guard_radius_m` of the calibrated guard position. None if it never
    /// returns inside the analyzed window (itself a fault signal) or guard
    /// keypoints unobserved.
    pub guard_recovery_ms: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct MetricsConfig {
    /// How close the wrist must get back to guard to count as recovered.
    pub guard_radius_m: f64,
    /// How far past the strike end to search for guard recovery.
    pub recovery_search_ms: f64,
}

impl Default for MetricsConfig {
    fn default() -> Self {
        MetricsConfig {
            guard_radius_m: 0.12,
            recovery_search_ms: 800.0,
        }
    }
}

fn shoulder_for(hand: Hand) -> Joint {
    match hand {
        Hand::Left => Joint::LeftShoulder,
        Hand::Right => Joint::RightShoulder,
    }
}

fn guard_for(profile: &BodyProfile, hand: Hand) -> [f64; 2] {
    match hand {
        Hand::Left => profile.guard_left,
        Hand::Right => profile.guard_right,
    }
}

/// Whether `hand` is the lead hand in this profile's stance.
pub fn is_lead_hand(profile: &BodyProfile, hand: Hand) -> bool {
    matches!(
        (profile.stance, hand),
        (Stance::Orthodox, Hand::Left) | (Stance::Southpaw, Hand::Right)
    )
}

/// Compute metrics for one strike candidate.
///
/// Coordinate expectation: the sequence is in a metric space (body-space or
/// calibrated camera-space, meters). Guard positions in the profile are in
/// the same space.
pub fn strike_metrics(
    seq: &Sequence,
    strike: &StrikeCandidate,
    profile: &BodyProfile,
    cfg: &MetricsConfig,
) -> StrikeMetrics {
    let wrist = strike.hand.wrist();
    let shoulder = shoulder_for(strike.hand);

    // --- Extension & apex ---------------------------------------------------
    let mut max_ext = None::<f64>;
    let mut apex_idx = strike.peak_idx;
    for i in strike.onset_idx..=strike.end_idx.min(seq.frames.len() - 1) {
        let f = &seq.frames[i];
        if let (Some(w), Some(s)) = (f.get(wrist), f.get(shoulder)) {
            let d = ((w.x - s.x).powi(2) + (w.y - s.y).powi(2)).sqrt();
            if max_ext.is_none_or(|m| d > m) {
                max_ext = Some(d);
                apex_idx = i;
            }
        }
    }
    let extension_frac = max_ext.map(|d| d / profile.arm_length_m);

    // --- Straightness (onset → apex path) -----------------------------------
    let straightness = {
        let mut path = 0.0;
        let mut prev = None;
        let mut first = None;
        let mut last = None;
        for i in strike.onset_idx..=apex_idx {
            if let Some(w) = seq.frames[i].get(wrist) {
                if first.is_none() {
                    first = Some(w);
                }
                if let Some(p) = prev {
                    path += crate::geometry::distance(p, w);
                }
                prev = Some(w);
                last = Some(w);
            }
        }
        match (first, last) {
            (Some(a), Some(b)) if path > 1e-6 => {
                Some((crate::geometry::distance(a, b) / path).min(1.0))
            }
            _ => None,
        }
    };

    // --- Guard recovery ------------------------------------------------------
    let guard = guard_for(profile, strike.hand);
    let apex_t = seq.frames[apex_idx].t_ms;
    let deadline = apex_t + cfg.recovery_search_ms;
    let mut guard_recovery_ms = None;
    for f in seq.frames.iter().skip(apex_idx) {
        if f.t_ms > deadline {
            break;
        }
        if let Some(w) = f.get(wrist) {
            let d = ((w.x - guard[0]).powi(2) + (w.y - guard[1]).powi(2)).sqrt();
            if d <= cfg.guard_radius_m {
                guard_recovery_ms = Some(f.t_ms - apex_t);
                break;
            }
        }
    }

    StrikeMetrics {
        peak_speed_mps: strike.peak_speed_mps,
        extension_frac,
        straightness,
        guard_recovery_ms,
    }
}
