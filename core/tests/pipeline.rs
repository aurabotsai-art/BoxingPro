//! End-to-end pipeline tests over synthetic skeletons with known ground
//! truth — the seed of the golden-file harness (docs/04 §8). If these
//! tolerances feel loose or tight later, change them consciously: they encode
//! the accuracy claims the product is allowed to make.

use boxingpro_core::events::{detect_strikes, DetectorConfig, Hand, LiveDetector};
use boxingpro_core::metrics::{strike_metrics, MetricsConfig};
use boxingpro_core::synthetic::{jab_sequence, profile, SyntheticJab};
use boxingpro_core::types::Sequence;

const HEIGHT: f64 = 1.8;

#[test]
fn detects_exactly_one_jab_and_recovers_ground_truth() {
    let jab = SyntheticJab::default(); // 60fps
    let seq = jab_sequence(HEIGHT, &jab);
    let prof = profile(HEIGHT);

    let left = detect_strikes(&seq, Hand::Left, &DetectorConfig::default());
    let right = detect_strikes(&seq, Hand::Right, &DetectorConfig::default());

    assert_eq!(
        left.len(),
        1,
        "one jab thrown, one candidate expected (out+return merged)"
    );
    assert!(
        right.is_empty(),
        "static rear hand must produce no candidates"
    );

    let m = strike_metrics(&seq, &left[0], &prof, &MetricsConfig::default());

    let expected_peak = jab.expected_peak_speed_mps();
    let err = (m.peak_speed_mps - expected_peak).abs() / expected_peak;
    assert!(
        err < 0.10,
        "peak speed {:.2} vs truth {:.2} ({:.0}% off)",
        m.peak_speed_mps,
        expected_peak,
        err * 100.0
    );

    let ext = m
        .extension_frac
        .expect("full-body synthetic must measure extension");
    assert!((0.90..=1.05).contains(&ext), "extension_frac {ext}");

    let s = m.straightness.expect("straightness measurable");
    assert!(s > 0.97, "straight-line jab should be ~1.0, got {s}");

    let rec = m.guard_recovery_ms.expect("wrist returns to guard");
    assert!(
        rec > 0.0 && rec <= jab.back_ms + 2.0 * (1000.0 / jab.fps),
        "recovery {rec} ms"
    );
}

#[test]
fn higher_fps_measures_peak_speed_better() {
    // Documents R2 (docs/12): consumer fps undersamples punches. The 30fps
    // estimate must be visibly worse than 120fps against the same truth.
    let truth = SyntheticJab::default().expected_peak_speed_mps();
    let peak_at = |fps: f64| {
        let jab = SyntheticJab {
            fps,
            ..SyntheticJab::default()
        };
        let seq = jab_sequence(HEIGHT, &jab);
        let c = detect_strikes(&seq, Hand::Left, &DetectorConfig::default());
        assert_eq!(c.len(), 1, "must still detect at {fps}fps");
        c[0].peak_speed_mps
    };
    let err30 = (peak_at(30.0) - truth).abs() / truth;
    let err120 = (peak_at(120.0) - truth).abs() / truth;
    assert!(
        err120 < err30,
        "120fps error ({:.1}%) should beat 30fps error ({:.1}%)",
        err120 * 100.0,
        err30 * 100.0
    );
    assert!(
        err120 < 0.05,
        "120fps should be within 5%, got {:.1}%",
        err120 * 100.0
    );
}

#[test]
fn unobserved_wrist_frames_do_not_fabricate_events() {
    // Drop the wrist from every frame (occlusion) — the detector must stay
    // silent rather than hallucinate from partial data.
    let jab = SyntheticJab::default();
    let mut seq = jab_sequence(HEIGHT, &jab);
    for f in &mut seq.frames {
        f.joints[boxingpro_core::types::Joint::LeftWrist as usize] = None;
    }
    let c = detect_strikes(&seq, Hand::Left, &DetectorConfig::default());
    assert!(c.is_empty(), "no wrist data → no events, never a guess");
}

/// Three jabs in a row: three jab sequences concatenated with shifted time.
fn triple_jab_sequence() -> Sequence {
    let jab = SyntheticJab::default();
    let one = jab_sequence(HEIGHT, &jab);
    let span = one.frames.last().unwrap().t_ms + 1000.0 / jab.fps;
    let mut seq = Sequence::default();
    for rep in 0..3 {
        for f in &one.frames {
            let mut f = f.clone();
            f.t_ms += rep as f64 * span;
            seq.frames.push(f);
        }
    }
    seq
}

#[test]
fn live_detector_matches_batch_frame_by_frame() {
    // The Tier-1 incremental detector must produce byte-identical candidates
    // to the batch detector when fed the session one frame at a time — same
    // crate, same numbers, regardless of tier (docs/04 §4).
    let seq = triple_jab_sequence();
    let cfg = DetectorConfig::default();

    for hand in [Hand::Left, Hand::Right] {
        let batch = detect_strikes(&seq, hand, &cfg);
        let mut live = LiveDetector::new(hand, cfg.clone());
        let mut partial = Sequence::default();
        for f in &seq.frames {
            partial.frames.push(f.clone());
            live.advance(&partial);
        }
        assert_eq!(live.candidates().len(), batch.len(), "{hand:?} count");
        for (l, b) in live.candidates().iter().zip(&batch) {
            assert_eq!(l.onset_idx, b.onset_idx);
            assert_eq!(l.peak_idx, b.peak_idx);
            assert_eq!(l.end_idx, b.end_idx);
            assert!((l.peak_speed_mps - b.peak_speed_mps).abs() < 1e-12);
        }
    }
}

#[test]
fn live_detector_does_not_count_mid_punch() {
    // Truncate the session at the moment of peak extension: the window is
    // still open, so the live count must be 0 — a punch counts when it
    // completes, never mid-flight.
    let jab = SyntheticJab::default();
    let seq = jab_sequence(HEIGHT, &jab);
    let batch = detect_strikes(&seq, Hand::Left, &DetectorConfig::default());
    let peak_idx = batch[0].peak_idx;

    let mut live = LiveDetector::new(Hand::Left, DetectorConfig::default());
    let mut partial = Sequence::default();
    for f in &seq.frames[..=peak_idx + 1] {
        partial.frames.push(f.clone());
        live.advance(&partial);
    }
    assert!(
        live.candidates().is_empty(),
        "open window must not be reported mid-punch"
    );
    for f in &seq.frames[peak_idx + 2..] {
        partial.frames.push(f.clone());
        live.advance(&partial);
    }
    assert_eq!(live.candidates().len(), 1, "counts once the window closes");
}

#[test]
fn slow_deliberate_movement_is_not_a_strike() {
    // A 5x-slowed "jab" (technique-practice speed) must fall below the
    // min-peak threshold: deliberate slow reps are not strikes.
    let jab = SyntheticJab {
        out_ms: 450.0,
        back_ms: 700.0,
        ..SyntheticJab::default()
    };
    let seq = jab_sequence(HEIGHT, &jab);
    let c = detect_strikes(&seq, Hand::Left, &DetectorConfig::default());
    assert!(
        c.is_empty(),
        "slow movement (~{:.1} m/s peak) must not register",
        jab.expected_peak_speed_mps()
    );
}
