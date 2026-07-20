//! Fault primitives (docs/05-PERCEPTION-PIPELINE.md stage 8).
//!
//! Thin, deterministic rule layer mapping metrics → time-stamped fault
//! instances with evidence. Coaching semantics (severity models, causes,
//! fixes, prioritization) live in the content taxonomy and the Coach Brain
//! (docs/06); this layer only detects. Fault ids MUST match
//! `content/faults/*.yaml` — the content linter enforces the linkage.

use crate::metrics::StrikeMetrics;
use crate::types::StrikeClass;

/// A classified, measured strike — the classifier's output joined with the
/// Metrics Core output. This is the stage-8 input record.
#[derive(Debug, Clone)]
pub struct StrikeRecord {
    pub t_apex_ms: f64,
    pub class: StrikeClass,
    pub metrics: StrikeMetrics,
}

/// One detected fault instance with its evidence.
#[derive(Debug, Clone)]
pub struct FaultInstance {
    /// Key into content/faults taxonomy.
    pub fault_id: &'static str,
    /// Apex timestamps of the strikes evidencing this instance.
    pub evidence_t_ms: Vec<f64>,
    /// Occurrences per opportunity, 0..1.
    pub frequency: f64,
}

/// Detection thresholds. These defaults are the *novice* policy; production
/// scales them per-user from calibration baselines and level — thresholds
/// are coaching policy, centrally configured (docs/05 stage 8), so callers
/// construct this from taxonomy config, not from constants scattered in code.
#[derive(Debug, Clone)]
pub struct FaultThresholds {
    /// Guard recovery slower than this is a dropped-hands instance.
    pub guard_recovery_ms: f64,
    /// Extension beyond this fraction of calibrated reach is overextension.
    pub overextension_frac: f64,
    /// Minimum opportunities before a frequency is reportable at all —
    /// two sloppy jabs in a two-punch session is not a pattern (docs/03 §1).
    pub min_opportunities: usize,
}

impl Default for FaultThresholds {
    fn default() -> Self {
        FaultThresholds {
            guard_recovery_ms: 550.0,
            overextension_frac: 1.02,
            min_opportunities: 5,
        }
    }
}

pub const HANDS_DROP_AFTER_PUNCH: &str = "hands_drop_after_punch";
pub const OVEREXTENSION: &str = "overextension";

/// Hands dropping after punches: recovery slower than threshold, or the
/// wrist never returned to guard within the analysis window at all
/// (`guard_recovery_ms == None` on an observed strike counts as the worst
/// case, not as missing data — the metric layer only emits None-with-strike
/// when the return was genuinely absent).
pub fn detect_hands_drop(strikes: &[StrikeRecord], th: &FaultThresholds) -> Option<FaultInstance> {
    let opportunities: Vec<&StrikeRecord> = strikes
        .iter()
        .filter(|s| s.class != StrikeClass::Feint)
        .collect();
    if opportunities.len() < th.min_opportunities {
        return None;
    }
    let evidence: Vec<f64> = opportunities
        .iter()
        .filter(|s| match s.metrics.guard_recovery_ms {
            Some(ms) => ms > th.guard_recovery_ms,
            None => true,
        })
        .map(|s| s.t_apex_ms)
        .collect();
    if evidence.is_empty() {
        return None;
    }
    Some(FaultInstance {
        fault_id: HANDS_DROP_AFTER_PUNCH,
        frequency: evidence.len() as f64 / opportunities.len() as f64,
        evidence_t_ms: evidence,
    })
}

/// Overextension on straight punches only (hooks legitimately measure long).
/// Strikes whose extension was unobservable are excluded from BOTH numerator
/// and denominator — unobserved is never evidence for or against.
pub fn detect_overextension(
    strikes: &[StrikeRecord],
    th: &FaultThresholds,
) -> Option<FaultInstance> {
    let opportunities: Vec<(&StrikeRecord, f64)> = strikes
        .iter()
        .filter(|s| s.class.is_straight())
        .filter_map(|s| s.metrics.extension_frac.map(|e| (s, e)))
        .collect();
    if opportunities.len() < th.min_opportunities {
        return None;
    }
    let evidence: Vec<f64> = opportunities
        .iter()
        .filter(|(_, e)| *e > th.overextension_frac)
        .map(|(s, _)| s.t_apex_ms)
        .collect();
    if evidence.is_empty() {
        return None;
    }
    Some(FaultInstance {
        fault_id: OVEREXTENSION,
        frequency: evidence.len() as f64 / opportunities.len() as f64,
        evidence_t_ms: evidence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strike(t: f64, class: StrikeClass, recovery: Option<f64>, ext: Option<f64>) -> StrikeRecord {
        StrikeRecord {
            t_apex_ms: t,
            class,
            metrics: StrikeMetrics {
                peak_speed_mps: 7.0,
                extension_frac: ext,
                straightness: Some(0.98),
                guard_recovery_ms: recovery,
            },
        }
    }

    #[test]
    fn hands_drop_fires_on_slow_and_absent_returns() {
        let strikes: Vec<StrikeRecord> = (0..10)
            .map(|i| {
                let rec = match i {
                    0 | 1 => Some(700.0), // slow
                    2 => None,            // never returned
                    _ => Some(300.0),     // crisp
                };
                strike(i as f64 * 1000.0, StrikeClass::Jab, rec, Some(0.95))
            })
            .collect();
        let f = detect_hands_drop(&strikes, &FaultThresholds::default()).expect("must fire");
        assert_eq!(f.evidence_t_ms.len(), 3);
        assert!((f.frequency - 0.3).abs() < 1e-9);
    }

    #[test]
    fn too_few_opportunities_reports_nothing() {
        let strikes: Vec<StrikeRecord> = (0..3)
            .map(|i| strike(i as f64, StrikeClass::Jab, Some(900.0), Some(0.9)))
            .collect();
        assert!(detect_hands_drop(&strikes, &FaultThresholds::default()).is_none());
    }

    #[test]
    fn overextension_ignores_hooks_and_unobserved() {
        let mut strikes = vec![
            strike(0.0, StrikeClass::LeadHook, Some(300.0), Some(1.30)), // hook: exempt
            strike(1000.0, StrikeClass::Jab, Some(300.0), None),         // unobserved: excluded
        ];
        for i in 0..6 {
            let ext = if i < 2 { 1.06 } else { 0.97 };
            strikes.push(strike(
                2000.0 + i as f64 * 1000.0,
                StrikeClass::Cross,
                Some(300.0),
                Some(ext),
            ));
        }
        let f = detect_overextension(&strikes, &FaultThresholds::default()).expect("must fire");
        assert_eq!(f.evidence_t_ms.len(), 2, "only the two long crosses");
        assert!(
            (f.frequency - 2.0 / 6.0).abs() < 1e-9,
            "denominator excludes hook and unobserved"
        );
    }

    #[test]
    fn clean_session_reports_no_faults() {
        let strikes: Vec<StrikeRecord> = (0..10)
            .map(|i| strike(i as f64 * 800.0, StrikeClass::Jab, Some(320.0), Some(0.96)))
            .collect();
        let th = FaultThresholds::default();
        assert!(detect_hands_drop(&strikes, &th).is_none());
        assert!(detect_overextension(&strikes, &th).is_none());
    }
}
