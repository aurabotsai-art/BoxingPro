//! Rhythm analysis (docs/05-PERCEPTION-PIPELINE.md stage 7).
//!
//! Bounce cadence and rhythm predictability from vertical oscillation of a
//! reference signal (typically mid-hip or COM height). Autocorrelation-based:
//! no FFT dependency, robust to moderate noise, fully deterministic.
//!
//! The predictability index feeds the `predictable_rhythm` fault
//! (content/faults/predictable_rhythm.yaml): a fighter whose bounce
//! autocorrelates strongly at one lag can be timed.

/// Result of rhythm analysis over a window.
#[derive(Debug, Clone)]
pub struct RhythmSummary {
    /// Dominant bounce cadence, Hz.
    pub cadence_hz: f64,
    /// Normalized autocorrelation strength at the dominant period, 0..1.
    /// High = metronomic (timeable); low = broken rhythm.
    pub predictability_index: f64,
}

#[derive(Debug, Clone)]
pub struct RhythmConfig {
    /// Search band for the bounce period.
    pub min_period_ms: f64,
    pub max_period_ms: f64,
    /// Uniform resample interval.
    pub resample_dt_ms: f64,
    /// Minimum observed input duration to report anything.
    pub min_window_ms: f64,
}

impl Default for RhythmConfig {
    fn default() -> Self {
        RhythmConfig {
            min_period_ms: 250.0,  // 4 Hz — faster than any real bounce
            max_period_ms: 1500.0, // 0.67 Hz — slower is drift, not rhythm
            resample_dt_ms: 20.0,
            min_window_ms: 4000.0,
        }
    }
}

/// Analyze a (t_ms, value) series — irregular sampling and gaps allowed;
/// linear interpolation to a uniform grid happens internally.
/// Returns `None` when the window is too short, too sparse, or shows no
/// oscillation above noise (a flat-footed fighter has no cadence — that is
/// itself a finding, reported as absence, not as a fake number).
pub fn analyze(samples: &[(f64, f64)], cfg: &RhythmConfig) -> Option<RhythmSummary> {
    if samples.len() < 8 {
        return None;
    }
    let t0 = samples.first().unwrap().0;
    let t1 = samples.last().unwrap().0;
    if t1 - t0 < cfg.min_window_ms {
        return None;
    }

    // Uniform resample (linear interpolation between neighbors).
    let n = ((t1 - t0) / cfg.resample_dt_ms).floor() as usize + 1;
    let mut y = Vec::with_capacity(n);
    let mut j = 0usize;
    for i in 0..n {
        let t = t0 + i as f64 * cfg.resample_dt_ms;
        while j + 1 < samples.len() && samples[j + 1].0 < t {
            j += 1;
        }
        let (ta, va) = samples[j];
        let v = if j + 1 < samples.len() {
            let (tb, vb) = samples[j + 1];
            if tb > ta {
                va + (vb - va) * ((t - ta) / (tb - ta))
            } else {
                va
            }
        } else {
            va
        };
        y.push(v);
    }

    // Mean-remove.
    let mean = y.iter().sum::<f64>() / y.len() as f64;
    for v in &mut y {
        *v -= mean;
    }
    let energy: f64 = y.iter().map(|v| v * v).sum();
    if energy / (y.len() as f64) < 1e-8 {
        return None; // essentially flat: no rhythm to measure
    }

    // Normalized autocorrelation over the lag band; pick the strongest peak.
    let min_lag = (cfg.min_period_ms / cfg.resample_dt_ms).round() as usize;
    let max_lag = ((cfg.max_period_ms / cfg.resample_dt_ms).round() as usize).min(y.len() / 2);
    if min_lag >= max_lag {
        return None;
    }
    let mut best = (0usize, f64::MIN);
    for lag in min_lag..=max_lag {
        let m = y.len() - lag;
        let mut num = 0.0;
        let mut d1 = 0.0;
        let mut d2 = 0.0;
        for i in 0..m {
            num += y[i] * y[i + lag];
            d1 += y[i] * y[i];
            d2 += y[i + lag] * y[i + lag];
        }
        let denom = (d1 * d2).sqrt();
        if denom > 0.0 {
            let r = num / denom;
            if r > best.1 {
                best = (lag, r);
            }
        }
    }
    let (lag, r) = best;
    if r <= 0.0 {
        return None; // anti-correlated / aperiodic: no dominant cadence
    }
    Some(RhythmSummary {
        cadence_hz: 1000.0 / (lag as f64 * cfg.resample_dt_ms),
        predictability_index: r.clamp(0.0, 1.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn series(f: impl Fn(f64) -> f64, dur_ms: f64, dt_ms: f64) -> Vec<(f64, f64)> {
        let n = (dur_ms / dt_ms) as usize;
        (0..=n)
            .map(|i| (i as f64 * dt_ms, f(i as f64 * dt_ms)))
            .collect()
    }

    #[test]
    fn metronomic_bounce_is_detected_with_high_predictability() {
        // Pure 2 Hz bounce, 3 cm amplitude — a metronome.
        let s = series(
            |t| 0.03 * (2.0 * std::f64::consts::PI * 2.0 * t / 1000.0).sin(),
            8000.0,
            16.6,
        );
        let r = analyze(&s, &RhythmConfig::default()).expect("clear rhythm must be found");
        assert!(
            (r.cadence_hz - 2.0).abs() < 0.15,
            "cadence {} ≠ 2 Hz",
            r.cadence_hz
        );
        assert!(
            r.predictability_index > 0.9,
            "metronome should score >0.9, got {}",
            r.predictability_index
        );
    }

    #[test]
    fn broken_rhythm_scores_lower_than_metronome() {
        // Tempo alternates between 1.6 Hz and 2.6 Hz every second, with
        // deterministic per-sample jitter: a fighter mixing the beat.
        let noise =
            |t: f64| (((t as u64).wrapping_mul(2654435761) % 1000) as f64 / 1000.0 - 0.5) * 0.012;
        let broken = series(
            |t| {
                let f = if ((t / 1000.0) as u64).is_multiple_of(2) {
                    1.6
                } else {
                    2.6
                };
                0.03 * (2.0 * std::f64::consts::PI * f * t / 1000.0).sin() + noise(t)
            },
            8000.0,
            16.6,
        );
        let metro = series(
            |t| 0.03 * (2.0 * std::f64::consts::PI * 2.0 * t / 1000.0).sin(),
            8000.0,
            16.6,
        );

        let rb = analyze(&broken, &RhythmConfig::default()).expect("still has some periodicity");
        let rm = analyze(&metro, &RhythmConfig::default()).unwrap();
        assert!(
            rb.predictability_index < rm.predictability_index - 0.15,
            "broken {} should be well below metronome {}",
            rb.predictability_index,
            rm.predictability_index
        );
    }

    #[test]
    fn flat_signal_reports_no_rhythm() {
        let s = series(|_| 0.95, 8000.0, 16.6);
        assert!(
            analyze(&s, &RhythmConfig::default()).is_none(),
            "flat feet → no cadence, not a fake one"
        );
    }

    #[test]
    fn short_window_reports_nothing() {
        let s = series(
            |t| 0.03 * (2.0 * std::f64::consts::PI * 2.0 * t / 1000.0).sin(),
            2000.0,
            16.6,
        );
        assert!(analyze(&s, &RhythmConfig::default()).is_none());
    }
}
