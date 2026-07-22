//! Fault prioritization (docs/06-COACHING-ENGINE.md §3) — the coach's brain,
//! deterministic. One primary focus, ≤2 secondary mentions, everything else
//! logged silently.
//!
//! priority = severity × frequency × trainability × prerequisite_gate × novelty_decay

#[derive(Debug, Clone)]
pub struct FaultScoreInput {
    pub fault_id: String,
    /// 0..1 from the taxonomy severity model.
    pub severity: f64,
    /// Occurrences per opportunity this session, 0..1.
    pub frequency: f64,
    /// 0..1 from the taxonomy: how fast this typically improves
    /// (quick wins early build trust).
    pub trainability: f64,
    /// True if any prerequisite fault is still unaddressed → hard gate.
    pub prerequisites_unresolved: bool,
    /// Sessions since this fault was last the primary focus.
    /// None = never coached.
    pub sessions_since_coached: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct PrioritizedFault {
    pub fault_id: String,
    pub priority: f64,
}

#[derive(Debug, Clone, Default)]
pub struct CoachingFocus {
    pub primary: Option<PrioritizedFault>,
    pub secondary: Vec<PrioritizedFault>,
    /// Detected but not surfaced this session (logged to the fighter model).
    pub logged: Vec<PrioritizedFault>,
}

/// Don't repeat yesterday's lecture; rotate focus while tracking the
/// stubborn fault (docs/06 §3).
fn novelty_decay(sessions_since: Option<u32>) -> f64 {
    match sessions_since {
        Some(0) => 0.4,
        Some(1) => 0.7,
        _ => 1.0,
    }
}

pub fn prioritize(inputs: &[FaultScoreInput]) -> CoachingFocus {
    let mut scored: Vec<PrioritizedFault> = inputs
        .iter()
        .map(|i| {
            let gate = if i.prerequisites_unresolved { 0.0 } else { 1.0 };
            PrioritizedFault {
                fault_id: i.fault_id.clone(),
                priority: (i.severity.clamp(0.0, 1.0))
                    * i.frequency.clamp(0.0, 1.0)
                    * i.trainability.clamp(0.0, 1.0)
                    * gate
                    * novelty_decay(i.sessions_since_coached),
            }
        })
        .filter(|p| p.priority > 0.0)
        .collect();
    scored.sort_by(|a, b| b.priority.partial_cmp(&a.priority).unwrap());

    let mut it = scored.into_iter();
    let primary = it.next();
    let secondary: Vec<_> = it.by_ref().take(2).collect();
    CoachingFocus {
        primary,
        secondary,
        logged: it.collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: &str, sev: f64, freq: f64, train: f64) -> FaultScoreInput {
        FaultScoreInput {
            fault_id: id.into(),
            severity: sev,
            frequency: freq,
            trainability: train,
            prerequisites_unresolved: false,
            sessions_since_coached: None,
        }
    }

    #[test]
    fn orders_and_partitions() {
        let f = prioritize(&[
            input("a", 0.9, 0.5, 0.8), // 0.36
            input("b", 0.5, 0.5, 0.5), // 0.125
            input("c", 0.9, 0.9, 0.9), // 0.729
            input("d", 0.3, 0.3, 0.3),
            input("e", 0.2, 0.2, 0.2),
        ]);
        assert_eq!(f.primary.unwrap().fault_id, "c");
        assert_eq!(f.secondary.len(), 2);
        assert_eq!(f.secondary[0].fault_id, "a");
        assert_eq!(f.logged.len(), 2);
    }

    #[test]
    fn prerequisite_gate_zeroes_even_the_worst_fault() {
        let mut power = input("no_hip", 1.0, 1.0, 1.0);
        power.prerequisites_unresolved = true; // stance is still broken
        let base = input("stance_too_narrow", 0.6, 0.5, 0.9);
        let f = prioritize(&[power, base]);
        assert_eq!(f.primary.unwrap().fault_id, "stance_too_narrow");
        assert!(
            f.logged.is_empty() && f.secondary.is_empty(),
            "gated fault fully suppressed"
        );
    }

    #[test]
    fn novelty_rotates_yesterdays_lecture() {
        let mut coached = input("hands_drop", 0.9, 0.6, 0.8); // raw 0.432
        coached.sessions_since_coached = Some(0); // → 0.173
        let fresh = input("overextension", 0.7, 0.5, 0.7); // 0.245
        let f = prioritize(&[coached, fresh]);
        assert_eq!(
            f.primary.unwrap().fault_id,
            "overextension",
            "fresh fault wins over just-coached"
        );
    }

    #[test]
    fn empty_and_all_gated_yield_empty_focus() {
        assert!(prioritize(&[]).primary.is_none());
        let mut g = input("x", 1.0, 1.0, 1.0);
        g.prerequisites_unresolved = true;
        assert!(prioritize(&[g]).primary.is_none());
    }
}
