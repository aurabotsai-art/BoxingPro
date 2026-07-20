//! Signal filters for keypoint streams.
//!
//! The live display path uses the One-Euro filter (minimal lag, jitter
//! suppression at rest, responsiveness under fast motion — exactly the
//! punch/stillness duality boxing produces). The analysis path may layer
//! additional smoothing; both live here so every platform filters identically
//! (docs/05-PERCEPTION-PIPELINE.md §3).

/// One-Euro filter (Casiez et al. 2012), one scalar channel.
///
/// `min_cutoff` sets jitter suppression at rest; `beta` scales cutoff with
/// speed so fast motion passes through with low lag.
#[derive(Debug, Clone)]
pub struct OneEuro {
    min_cutoff_hz: f64,
    beta: f64,
    d_cutoff_hz: f64,
    prev: Option<(f64, f64, f64)>, // (t_s, x_filtered, dx_filtered)
}

impl OneEuro {
    pub fn new(min_cutoff_hz: f64, beta: f64) -> Self {
        OneEuro {
            min_cutoff_hz,
            beta,
            d_cutoff_hz: 1.0,
            prev: None,
        }
    }

    /// Defaults tuned for keypoint streams at 30–120fps; revisit against
    /// device noise measurements in Phase 0 (docs/11 S0.1).
    pub fn keypoint_default() -> Self {
        Self::new(1.0, 0.3)
    }

    fn alpha(cutoff_hz: f64, dt_s: f64) -> f64 {
        let tau = 1.0 / (2.0 * core::f64::consts::PI * cutoff_hz);
        1.0 / (1.0 + tau / dt_s)
    }

    /// Feed a sample at time `t_ms`; returns the filtered value.
    /// Out-of-order or duplicate timestamps return the previous value.
    pub fn filter(&mut self, t_ms: f64, x: f64) -> f64 {
        let t_s = t_ms / 1000.0;
        match self.prev {
            None => {
                self.prev = Some((t_s, x, 0.0));
                x
            }
            Some((pt, px, pdx)) => {
                let dt = t_s - pt;
                if dt <= 0.0 {
                    return px;
                }
                let dx = (x - px) / dt;
                let a_d = Self::alpha(self.d_cutoff_hz, dt);
                let dx_f = a_d * dx + (1.0 - a_d) * pdx;
                let cutoff = self.min_cutoff_hz + self.beta * dx_f.abs();
                let a = Self::alpha(cutoff, dt);
                let x_f = a * x + (1.0 - a) * px;
                self.prev = Some((t_s, x_f, dx_f));
                x_f
            }
        }
    }

    pub fn reset(&mut self) {
        self.prev = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_constant_signal_unchanged() {
        let mut f = OneEuro::keypoint_default();
        for i in 0..100 {
            let y = f.filter(i as f64 * 16.6, 5.0);
            assert!((y - 5.0).abs() < 1e-9);
        }
    }

    #[test]
    fn reduces_noise_variance_at_rest() {
        // Deterministic pseudo-noise around a constant.
        let mut f = OneEuro::keypoint_default();
        let noise = |i: usize| ((i * 2654435761 % 1000) as f64 / 1000.0 - 0.5) * 0.02;
        let mut raw_var = 0.0;
        let mut fil_var = 0.0;
        let mut n = 0.0;
        for i in 0..600 {
            let x = 1.0 + noise(i);
            let y = f.filter(i as f64 * 16.6, x);
            if i > 60 {
                raw_var += (x - 1.0) * (x - 1.0);
                fil_var += (y - 1.0) * (y - 1.0);
                n += 1.0;
            }
        }
        assert!(
            fil_var / n < 0.25 * (raw_var / n),
            "filter should cut variance ≥4x at rest"
        );
    }

    #[test]
    fn tracks_fast_ramp_with_low_lag() {
        // A punch-speed ramp: 8 m/s. Lag must stay small (< 25 ms worth).
        let mut f = OneEuro::keypoint_default();
        let mut last_err = 0.0;
        for i in 0..60 {
            let t = i as f64 * (1000.0 / 60.0);
            let x = 8.0 * (t / 1000.0);
            let y = f.filter(t, x);
            last_err = (x - y).abs();
        }
        assert!(
            last_err < 8.0 * 0.025,
            "lag {last_err} m exceeds 25 ms at 8 m/s"
        );
    }
}
