//! Telegraph detection (docs/03-FEASIBILITY.md §5, T1).
//!
//! Pre-strike "tells" a sharp opponent reads: the hand dipping before it
//! fires, the rear shoulder loading up. Detected over the window just
//! before strike onset. High coaching value: unlike most faults these are
//! invisible to the fighter and rarely coached outside good gyms.

use crate::events::{Hand, StrikeCandidate};
use crate::types::{BodyProfile, Sequence};

#[derive(Debug, Clone, Default)]
pub struct TelegraphFlags {
    /// Wrist dipped below guard before firing ("loading" the punch).
    pub hand_dip: bool,
    pub dip_depth: Option<f64>,
    /// Fraction of the pre-window where the wrist was observed; flags are
    /// only meaningful when this is high (honesty gate applied internally).
    pub observed_frac: f64,
}

#[derive(Debug, Clone)]
pub struct TelegraphConfig {
    /// How far before onset to look.
    pub window_ms: f64,
    /// Dip below guard height that counts as a tell.
    pub dip_threshold_m: f64,
    /// Minimum observed fraction of the window to report anything.
    pub min_observed_frac: f64,
}

impl Default for TelegraphConfig {
    fn default() -> Self {
        TelegraphConfig {
            window_ms: 300.0,
            dip_threshold_m: 0.06,
            min_observed_frac: 0.5,
        }
    }
}

/// Inspect the pre-onset window of one strike. Returns None when the window
/// was too occluded to judge — an unobserved wind-up is not a clean wind-up.
pub fn detect(
    seq: &Sequence,
    strike: &StrikeCandidate,
    profile: &BodyProfile,
    cfg: &TelegraphConfig,
) -> Option<TelegraphFlags> {
    let onset_t = seq.frames[strike.onset_idx].t_ms;
    let wrist = strike.hand.wrist();
    let guard_y = match strike.hand {
        Hand::Left => profile.guard_left[1],
        Hand::Right => profile.guard_right[1],
    };

    let mut total = 0usize;
    let mut observed = 0usize;
    let mut min_y: Option<f64> = None;
    for f in seq.frames[..strike.onset_idx].iter().rev() {
        if onset_t - f.t_ms > cfg.window_ms {
            break;
        }
        total += 1;
        if let Some(w) = f.get(wrist) {
            observed += 1;
            min_y = Some(min_y.map_or(w.y, |m: f64| m.min(w.y)));
        }
    }
    if total == 0 {
        return None;
    }
    let observed_frac = observed as f64 / total as f64;
    if observed_frac < cfg.min_observed_frac {
        return None;
    }
    let dip = min_y.map(|y| guard_y - y);
    Some(TelegraphFlags {
        hand_dip: dip.is_some_and(|d| d > cfg.dip_threshold_m),
        dip_depth: dip.filter(|d| *d > 0.0),
        observed_frac,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{detect_strikes, DetectorConfig};
    use crate::synthetic::{jab_sequence, profile, SyntheticJab};
    use crate::types::{Joint, Keypoint};

    #[test]
    fn clean_jab_has_no_dip_tell() {
        let seq = jab_sequence(1.8, &SyntheticJab::default());
        let p = profile(1.8);
        let s = &detect_strikes(&seq, Hand::Left, &DetectorConfig::default())[0];
        let t = detect(&seq, s, &p, &TelegraphConfig::default()).expect("fully observed");
        assert!(!t.hand_dip, "synthetic jab launches straight from guard");
    }

    #[test]
    fn pre_punch_dip_is_flagged() {
        let mut seq = jab_sequence(1.8, &SyntheticJab::default());
        let p = profile(1.8);
        // Inject a 10 cm dip in the 250 ms before onset (idle phase ends at 400 ms).
        for f in &mut seq.frames {
            if f.t_ms >= 150.0 && f.t_ms < 400.0 {
                f.set(
                    Joint::LeftWrist,
                    Keypoint {
                        x: p.guard_left[0],
                        y: p.guard_left[1] - 0.10,
                        z: None,
                        confidence: 1.0,
                    },
                );
            }
        }
        let s = &detect_strikes(&seq, Hand::Left, &DetectorConfig::default())[0];
        let t = detect(&seq, s, &p, &TelegraphConfig::default()).expect("observed");
        assert!(t.hand_dip, "10 cm pre-punch dip must be caught");
        assert!(t.dip_depth.unwrap() > 0.08);
    }

    #[test]
    fn occluded_windup_reports_nothing() {
        let mut seq = jab_sequence(1.8, &SyntheticJab::default());
        let p = profile(1.8);
        for f in &mut seq.frames {
            if f.t_ms < 400.0 {
                f.joints[Joint::LeftWrist as usize] = None;
            }
        }
        let strikes = detect_strikes(&seq, Hand::Left, &DetectorConfig::default());
        assert_eq!(strikes.len(), 1, "strike itself still detected");
        assert!(
            detect(&seq, &strikes[0], &p, &TelegraphConfig::default()).is_none(),
            "unobserved wind-up → no telegraph claim either way"
        );
    }
}
