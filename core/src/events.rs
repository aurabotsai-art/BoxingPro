//! Kinematic event detection (docs/05-PERCEPTION-PIPELINE.md stage 5).
//!
//! Model-free strike-candidate detection from wrist kinematics. Recall-biased
//! by design: candidates go to the classifier, whose null class absorbs false
//! positives; a missed punch is unrecoverable.

use crate::types::{Joint, Sequence};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hand {
    Left,
    Right,
}

impl Hand {
    pub fn wrist(self) -> Joint {
        match self {
            Hand::Left => Joint::LeftWrist,
            Hand::Right => Joint::RightWrist,
        }
    }
}

/// A candidate strike window, in frame indices into the source sequence.
#[derive(Debug, Clone)]
pub struct StrikeCandidate {
    pub hand: Hand,
    /// First frame where speed crossed the onset threshold.
    pub onset_idx: usize,
    /// Frame of peak wrist speed.
    pub peak_idx: usize,
    /// Frame where speed fell back below the release threshold.
    pub end_idx: usize,
    pub peak_speed_mps: f64,
}

#[derive(Debug, Clone)]
pub struct DetectorConfig {
    /// Speed that opens a candidate. Per-user scaling comes from calibration
    /// baselines (docs/03 §3); this default is conservative for adults.
    pub onset_speed_mps: f64,
    /// Speed that closes a candidate (hysteresis; must be < onset).
    pub release_speed_mps: f64,
    /// Minimum peak speed for the window to count at all.
    pub min_peak_speed_mps: f64,
    /// Minimum event duration; shorter spikes are noise.
    pub min_duration_ms: f64,
    /// Merge candidates on the same hand closer than this (double-count guard).
    pub merge_gap_ms: f64,
}

impl Default for DetectorConfig {
    fn default() -> Self {
        DetectorConfig {
            onset_speed_mps: 2.0,
            release_speed_mps: 1.2,
            min_peak_speed_mps: 3.0,
            min_duration_ms: 40.0,
            merge_gap_ms: 60.0,
        }
    }
}

/// Central-difference wrist speed (m/s) at frame `i`, or `None` when the
/// wrist is unobserved in a neighbor frame or `i` is a boundary frame.
/// Uses z when both samples carry it (camera-facing punches move mostly in
/// depth; 2D-only speed misses them).
fn wrist_speed_at(seq: &Sequence, wrist: Joint, i: usize) -> Option<f64> {
    if i == 0 || i + 1 >= seq.frames.len() {
        return None;
    }
    let (prev, next) = (&seq.frames[i - 1], &seq.frames[i + 1]);
    let (a, b) = (prev.get(wrist)?, next.get(wrist)?);
    let dt_s = (next.t_ms - prev.t_ms) / 1000.0;
    if dt_s <= 0.0 {
        return None;
    }
    let dz = match (a.z, b.z) {
        (Some(az), Some(bz)) => bz - az,
        _ => 0.0,
    };
    let d = ((b.x - a.x).powi(2) + (b.y - a.y).powi(2) + dz.powi(2)).sqrt();
    Some(d / dt_s)
}

/// Central-difference wrist speed series (m/s) for one hand. `None` where the
/// wrist (or a neighbor frame's wrist) is unobserved.
pub fn wrist_speed_series(seq: &Sequence, hand: Hand) -> Vec<Option<f64>> {
    let n = seq.frames.len();
    let mut out = vec![None; n];
    if n < 3 {
        return out;
    }
    let w = hand.wrist();
    for (i, slot) in out.iter_mut().enumerate().take(n - 1).skip(1) {
        *slot = wrist_speed_at(seq, w, i);
    }
    out
}

/// Detect strike candidates for one hand with threshold hysteresis.
pub fn detect_strikes(seq: &Sequence, hand: Hand, cfg: &DetectorConfig) -> Vec<StrikeCandidate> {
    let speeds = wrist_speed_series(seq, hand);
    let mut out: Vec<StrikeCandidate> = Vec::new();
    let mut open: Option<(usize, usize, f64)> = None; // (onset, peak_idx, peak)

    for (i, s) in speeds.iter().enumerate() {
        let s = match s {
            Some(v) => *v,
            None => continue, // unobserved frames neither open nor close windows
        };
        match open {
            None => {
                if s >= cfg.onset_speed_mps {
                    open = Some((i, i, s));
                }
            }
            Some((onset, peak_idx, peak)) => {
                if s > peak {
                    open = Some((onset, i, s));
                } else if s < cfg.release_speed_mps {
                    push_candidate(&mut out, seq, hand, onset, peak_idx, peak, i, cfg);
                    open = None;
                }
            }
        }
    }
    if let Some((onset, peak_idx, peak)) = open {
        let last = speeds.len() - 1;
        push_candidate(&mut out, seq, hand, onset, peak_idx, peak, last, cfg);
    }
    out
}

/// Incremental strike detector with batch-identical semantics for the live
/// tier: feed the growing session sequence after each frame and completed
/// candidates accumulate in O(1) amortized work per frame. The one deliberate
/// difference from [`detect_strikes`]: a still-open window is not reported
/// (the batch detector flushes it at end-of-stream; counting a punch mid-
/// flight would be wrong live).
#[derive(Debug, Clone)]
pub struct LiveDetector {
    hand: Hand,
    cfg: DetectorConfig,
    /// Next speed index to evaluate (speed at i needs frame i+1).
    next_idx: usize,
    open: Option<(usize, usize, f64)>, // (onset, peak_idx, peak)
    candidates: Vec<StrikeCandidate>,
}

impl LiveDetector {
    pub fn new(hand: Hand, cfg: DetectorConfig) -> LiveDetector {
        LiveDetector {
            hand,
            cfg,
            next_idx: 1,
            open: None,
            candidates: Vec::new(),
        }
    }

    pub fn hand(&self) -> Hand {
        self.hand
    }

    /// Completed strike candidates so far, oldest first.
    pub fn candidates(&self) -> &[StrikeCandidate] {
        &self.candidates
    }

    /// Process all newly computable frames of `seq` (the same, growing,
    /// session sequence must be passed each call).
    pub fn advance(&mut self, seq: &Sequence) {
        let w = self.hand.wrist();
        while self.next_idx + 1 < seq.frames.len() {
            let i = self.next_idx;
            self.next_idx += 1;
            let s = match wrist_speed_at(seq, w, i) {
                Some(v) => v,
                None => continue, // unobserved frames neither open nor close windows
            };
            match self.open {
                None => {
                    if s >= self.cfg.onset_speed_mps {
                        self.open = Some((i, i, s));
                    }
                }
                Some((onset, peak_idx, peak)) => {
                    if s > peak {
                        self.open = Some((onset, i, s));
                    } else if s < self.cfg.release_speed_mps {
                        push_candidate(
                            &mut self.candidates,
                            seq,
                            self.hand,
                            onset,
                            peak_idx,
                            peak,
                            i,
                            &self.cfg,
                        );
                        self.open = None;
                    }
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn push_candidate(
    out: &mut Vec<StrikeCandidate>,
    seq: &Sequence,
    hand: Hand,
    onset: usize,
    peak_idx: usize,
    peak: f64,
    end: usize,
    cfg: &DetectorConfig,
) {
    if peak < cfg.min_peak_speed_mps {
        return;
    }
    let dur = seq.frames[end].t_ms - seq.frames[onset].t_ms;
    if dur < cfg.min_duration_ms {
        return;
    }
    // Merge with previous same-hand candidate if the gap is tiny.
    if let Some(prev) = out.last_mut() {
        let gap = seq.frames[onset].t_ms - seq.frames[prev.end_idx].t_ms;
        if gap < cfg.merge_gap_ms {
            prev.end_idx = end;
            if peak > prev.peak_speed_mps {
                prev.peak_speed_mps = peak;
                prev.peak_idx = peak_idx;
            }
            return;
        }
    }
    out.push(StrikeCandidate {
        hand,
        onset_idx: onset,
        peak_idx,
        end_idx: end,
        peak_speed_mps: peak,
    });
}
