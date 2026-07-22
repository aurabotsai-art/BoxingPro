//! Combination assembly (docs/05-PERCEPTION-PIPELINE.md stage 6, post-processing).
//!
//! Pure sequencing over classified strikes — no ML. Strikes closer than
//! `max_gap_ms` chain into a combo; standard boxing numbering renders
//! notation ("1-1-2"). Unclassified strikes chain too (rendered "?") so
//! combo *rhythm* analysis works before the classifier ships.

use crate::faults::StrikeRecord;
use crate::types::StrikeClass;

#[derive(Debug, Clone)]
pub struct Combo {
    pub start_ms: f64,
    pub end_ms: f64,
    pub classes: Vec<StrikeClass>,
    /// Inter-strike intervals, ms (len = classes.len() - 1). Feeds the
    /// fixed-combo-cadence discriminator of `predictable_rhythm`.
    pub intervals_ms: Vec<f64>,
}

/// Standard American numbering; None for classes outside it.
pub fn punch_number(c: StrikeClass) -> Option<u8> {
    match c {
        StrikeClass::Jab => Some(1),
        StrikeClass::Cross => Some(2),
        StrikeClass::LeadHook => Some(3),
        StrikeClass::RearHook => Some(4),
        StrikeClass::LeadUppercut => Some(5),
        StrikeClass::RearUppercut => Some(6),
        _ => None,
    }
}

impl Combo {
    /// "1-1-2", with "?" for unclassified and "f" for feints.
    pub fn notation(&self) -> String {
        self.classes
            .iter()
            .map(|c| match (punch_number(*c), c) {
                (Some(n), _) => n.to_string(),
                (None, StrikeClass::Feint) => "f".to_string(),
                (None, _) => "?".to_string(),
            })
            .collect::<Vec<_>>()
            .join("-")
    }
}

/// Group time-ordered strikes into combos (single strikes excluded —
/// a combo is ≥2). Input must be sorted by `t_apex_ms`; panics in debug
/// if not, silently tolerates in release (order errors are caller bugs).
pub fn assemble(records: &[StrikeRecord], max_gap_ms: f64) -> Vec<Combo> {
    let mut out = Vec::new();
    let mut run: Vec<&StrikeRecord> = Vec::new();

    let flush = |run: &mut Vec<&StrikeRecord>, out: &mut Vec<Combo>| {
        if run.len() >= 2 {
            out.push(Combo {
                start_ms: run[0].t_apex_ms,
                end_ms: run[run.len() - 1].t_apex_ms,
                classes: run.iter().map(|r| r.class).collect(),
                intervals_ms: run
                    .windows(2)
                    .map(|w| w[1].t_apex_ms - w[0].t_apex_ms)
                    .collect(),
            });
        }
        run.clear();
    };

    for r in records {
        if let Some(last) = run.last() {
            debug_assert!(
                r.t_apex_ms >= last.t_apex_ms,
                "records must be time-ordered"
            );
            if r.t_apex_ms - last.t_apex_ms > max_gap_ms {
                flush(&mut run, &mut out);
            }
        }
        run.push(r);
    }
    flush(&mut run, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::StrikeMetrics;

    fn rec(t: f64, class: StrikeClass) -> StrikeRecord {
        StrikeRecord {
            t_apex_ms: t,
            class,
            metrics: StrikeMetrics {
                peak_speed_mps: 7.0,
                extension_frac: None,
                straightness: None,
                guard_recovery_ms: None,
            },
        }
    }

    #[test]
    fn chains_close_strikes_and_splits_on_gaps() {
        let rs = vec![
            rec(0.0, StrikeClass::Jab),
            rec(300.0, StrikeClass::Jab),
            rec(650.0, StrikeClass::Cross),
            rec(2500.0, StrikeClass::LeadHook), // isolated
            rec(4000.0, StrikeClass::Jab),
            rec(4400.0, StrikeClass::Cross),
        ];
        let combos = assemble(&rs, 800.0);
        assert_eq!(combos.len(), 2);
        assert_eq!(combos[0].notation(), "1-1-2");
        assert_eq!(combos[1].notation(), "1-2");
        assert_eq!(combos[0].intervals_ms, vec![300.0, 350.0]);
    }

    #[test]
    fn single_strikes_are_not_combos() {
        let rs = vec![rec(0.0, StrikeClass::Jab), rec(5000.0, StrikeClass::Cross)];
        assert!(assemble(&rs, 800.0).is_empty());
    }

    #[test]
    fn unclassified_and_feints_render_honestly() {
        let rs = vec![
            rec(0.0, StrikeClass::Feint),
            rec(250.0, StrikeClass::Unclassified),
            rec(500.0, StrikeClass::Cross),
        ];
        assert_eq!(assemble(&rs, 800.0)[0].notation(), "f-?-2");
    }
}
