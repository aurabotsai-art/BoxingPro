//! Synthetic skeleton generation for tests and golden files
//! (docs/04-SYSTEM-ARCHITECTURE.md §8: known kinematics in, exact numbers out).
//!
//! Coordinate convention here: meters, x lateral (right of camera view is
//! positive), y up, origin at floor under the body center. Deterministic —
//! no randomness anywhere in this crate.

use crate::types::{BodyProfile, Joint, Keypoint, PoseFrame, Sequence, Stance};

fn kp(x: f64, y: f64) -> Keypoint {
    Keypoint {
        x,
        y,
        z: None,
        confidence: 1.0,
    }
}

/// A symmetric standing body of the given height, all joints observed.
pub fn standing_frame(t_ms: f64, height_m: f64) -> PoseFrame {
    let h = height_m;
    let mut f = PoseFrame::empty(t_ms);
    f.set(Joint::Nose, kp(0.0, 0.94 * h));
    f.set(Joint::LeftEar, kp(-0.04 * h, 0.93 * h));
    f.set(Joint::RightEar, kp(0.04 * h, 0.93 * h));
    f.set(Joint::Chin, kp(0.0, 0.90 * h));
    f.set(Joint::MidChest, kp(0.0, 0.72 * h));
    f.set(Joint::LeftShoulder, kp(-0.11 * h, 0.82 * h));
    f.set(Joint::RightShoulder, kp(0.11 * h, 0.82 * h));
    f.set(Joint::LeftElbow, kp(-0.13 * h, 0.65 * h));
    f.set(Joint::RightElbow, kp(0.13 * h, 0.65 * h));
    f.set(Joint::LeftWrist, kp(-0.12 * h, 0.49 * h));
    f.set(Joint::RightWrist, kp(0.12 * h, 0.49 * h));
    f.set(Joint::LeftHip, kp(-0.06 * h, 0.53 * h));
    f.set(Joint::RightHip, kp(0.06 * h, 0.53 * h));
    f.set(Joint::LeftKnee, kp(-0.06 * h, 0.28 * h));
    f.set(Joint::RightKnee, kp(0.06 * h, 0.28 * h));
    f.set(Joint::LeftAnkle, kp(-0.06 * h, 0.04 * h));
    f.set(Joint::RightAnkle, kp(0.06 * h, 0.04 * h));
    f.set(Joint::LeftHeel, kp(-0.07 * h, 0.02 * h));
    f.set(Joint::RightHeel, kp(0.07 * h, 0.02 * h));
    f.set(Joint::LeftToe, kp(-0.05 * h, 0.0));
    f.set(Joint::RightToe, kp(0.05 * h, 0.0));
    f
}

/// Body profile matching [`standing_frame`] proportions for `height_m`,
/// orthodox stance, guard at the standing wrist positions raised to chin.
pub fn profile(height_m: f64) -> BodyProfile {
    let h = height_m;
    // Arm length per the synthetic proportions: shoulder→elbow→wrist.
    let upper = ((0.13 - 0.11f64) * h).hypot(0.82 * h - 0.65 * h);
    let fore = ((0.13 - 0.12f64) * h).hypot(0.65 * h - 0.49 * h);
    BodyProfile {
        height_m: h,
        arm_length_m: upper + fore,
        shoulder_width_m: 0.22 * h,
        stance: Stance::Orthodox,
        guard_left: [-0.09 * h, 0.86 * h],
        guard_right: [0.09 * h, 0.86 * h],
    }
}

/// Smoothstep 0→1.
fn ease(p: f64) -> f64 {
    let p = p.clamp(0.0, 1.0);
    p * p * (3.0 - 2.0 * p)
}

/// Parameters of a synthetic straight punch (lead-hand jab by default).
pub struct SyntheticJab {
    pub fps: f64,
    /// Extension travel of the wrist, meters.
    pub travel_m: f64,
    /// Time from initiation to full extension, ms.
    pub out_ms: f64,
    /// Time from extension back to guard, ms.
    pub back_ms: f64,
    /// Extra hold at guard before/after, ms.
    pub idle_ms: f64,
}

impl Default for SyntheticJab {
    fn default() -> Self {
        SyntheticJab {
            fps: 60.0,
            travel_m: 0.55,
            out_ms: 90.0,
            back_ms: 140.0,
            idle_ms: 400.0,
        }
    }
}

impl SyntheticJab {
    /// Peak wrist speed implied by the smoothstep profile: 1.5 × mean speed.
    pub fn expected_peak_speed_mps(&self) -> f64 {
        1.5 * self.travel_m / (self.out_ms / 1000.0)
    }
}

/// Generate a sequence containing exactly one left-hand (lead, orthodox) jab:
/// guard → full extension → back to guard, wrist raised to guard height
/// throughout. All other joints hold the standing pose.
pub fn jab_sequence(height_m: f64, p: &SyntheticJab) -> Sequence {
    let prof = profile(height_m);
    let dt = 1000.0 / p.fps;
    let total = p.idle_ms + p.out_ms + p.back_ms + p.idle_ms;
    let n = (total / dt).ceil() as usize + 1;

    let guard = prof.guard_left;
    let mut frames = Vec::with_capacity(n);
    for i in 0..n {
        let t = i as f64 * dt;
        let mut f = standing_frame(t, height_m);
        // Both hands at guard by default.
        f.set(Joint::LeftWrist, kp(guard[0], guard[1]));
        f.set(
            Joint::RightWrist,
            kp(prof.guard_right[0], prof.guard_right[1]),
        );

        let phase_t = t - p.idle_ms;
        let ext = if phase_t < 0.0 {
            0.0
        } else if phase_t <= p.out_ms {
            ease(phase_t / p.out_ms)
        } else if phase_t <= p.out_ms + p.back_ms {
            1.0 - ease((phase_t - p.out_ms) / p.back_ms)
        } else {
            0.0
        };
        // Jab extends laterally in +x from guard (synthetic side view).
        f.set(Joint::LeftWrist, kp(guard[0] + ext * p.travel_m, guard[1]));
        // Elbow follows halfway for plausibility.
        f.set(
            Joint::LeftElbow,
            kp(-0.13 * height_m + ext * p.travel_m * 0.45, 0.75 * height_m),
        );
        frames.push(f);
    }
    Sequence { frames }
}
