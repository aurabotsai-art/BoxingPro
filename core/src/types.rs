//! Canonical skeleton types.
//!
//! Every supported pose model (Apple Vision, RTMPose, MediaPipe, RTMW…) is
//! mapped by platform adapter code into this 21-point canonical skeleton
//! before reaching the core. Feet keypoints (heel/toe) are first-class
//! because footwork analysis requires them (docs/02-CV-RESEARCH.md §1.3).

/// Canonical keypoint indices. Order is part of SkeletonArchive v1 and must
/// never be reordered — append only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(usize)]
pub enum Joint {
    Nose = 0,
    LeftEar = 1,
    RightEar = 2,
    LeftShoulder = 3,
    RightShoulder = 4,
    LeftElbow = 5,
    RightElbow = 6,
    LeftWrist = 7,
    RightWrist = 8,
    LeftHip = 9,
    RightHip = 10,
    LeftKnee = 11,
    RightKnee = 12,
    LeftAnkle = 13,
    RightAnkle = 14,
    LeftHeel = 15,
    RightHeel = 16,
    LeftToe = 17,
    RightToe = 18,
    Chin = 19,
    MidChest = 20,
}

pub const JOINT_COUNT: usize = 21;

/// A single observed keypoint. `z` is optional: 2D-only models leave it
/// `None` and z-dependent metrics degrade honestly downstream.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Keypoint {
    pub x: f64,
    pub y: f64,
    pub z: Option<f64>,
    /// Model confidence in [0,1].
    pub confidence: f64,
}

/// One frame of pose data. Unobserved joints are `None` — adapters must gate
/// on per-model confidence thresholds before constructing frames.
#[derive(Debug, Clone)]
pub struct PoseFrame {
    /// Session-relative timestamp, milliseconds.
    pub t_ms: f64,
    pub joints: [Option<Keypoint>; JOINT_COUNT],
}

impl PoseFrame {
    pub fn empty(t_ms: f64) -> Self {
        PoseFrame {
            t_ms,
            joints: [None; JOINT_COUNT],
        }
    }

    pub fn get(&self, j: Joint) -> Option<Keypoint> {
        self.joints[j as usize]
    }

    pub fn set(&mut self, j: Joint, kp: Keypoint) {
        self.joints[j as usize] = Some(kp);
    }
}

/// Which side leads. Orthodox = left side leads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stance {
    Orthodox,
    Southpaw,
}

/// Strike classes v1 (docs/05 §6). Classification itself is ML and lives
/// outside this crate; the core consumes its output. `Unclassified` is a
/// first-class honest outcome (open-set rule), never a forced label.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrikeClass {
    Jab,
    Cross,
    LeadHook,
    RearHook,
    LeadUppercut,
    RearUppercut,
    Feint,
    Unclassified,
}

impl StrikeClass {
    /// Straight punches, for rules that only apply to linear trajectories.
    pub fn is_straight(self) -> bool {
        matches!(self, StrikeClass::Jab | StrikeClass::Cross)
    }
}

/// Calibrated fighter measurements produced by the calibration ritual
/// (docs/03-FEASIBILITY.md §3). Lengths in meters.
#[derive(Debug, Clone)]
pub struct BodyProfile {
    pub height_m: f64,
    /// Wrist-to-shoulder length per arm (used for extension %).
    pub arm_length_m: f64,
    pub shoulder_width_m: f64,
    pub stance: Stance,
    /// Resting guard wrist position in body-space, per hand, captured during
    /// calibration; used for guard-recovery metrics.
    pub guard_left: [f64; 2],
    pub guard_right: [f64; 2],
}

/// A contiguous window of frames, the unit consumed by event detection and
/// metrics. Frames must be time-ordered.
#[derive(Debug, Clone, Default)]
pub struct Sequence {
    pub frames: Vec<PoseFrame>,
}

impl Sequence {
    pub fn duration_ms(&self) -> f64 {
        match (self.frames.first(), self.frames.last()) {
            (Some(a), Some(b)) => b.t_ms - a.t_ms,
            _ => 0.0,
        }
    }

    /// Mean sample interval in ms; None with <2 frames.
    pub fn mean_dt_ms(&self) -> Option<f64> {
        if self.frames.len() < 2 {
            return None;
        }
        Some(self.duration_ms() / (self.frames.len() - 1) as f64)
    }
}
