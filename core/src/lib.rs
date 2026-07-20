//! BoxingPro Metrics Core.
//!
//! Deterministic biomechanics over pose keypoint streams. This crate is the
//! single implementation of every number BoxingPro shows a user
//! (docs/04-SYSTEM-ARCHITECTURE.md §2): it runs unchanged on iOS, Android,
//! and server workers so all tiers produce identical metrics.
//!
//! Pipeline position (docs/05-PERCEPTION-PIPELINE.md): platform code feeds
//! [`types::PoseFrame`]s (any pose model, mapped to the canonical skeleton),
//! this crate handles smoothing, normalization, event detection, and metrics.
//!
//! Invariants:
//! - No I/O, no clocks, no randomness: same input, same output, always.
//! - Missing data stays missing. Keypoints below confidence are `None`;
//!   metrics over unobserved joints return `None`, never a guess
//!   (the honesty rule, docs/03-FEASIBILITY.md §1).
//! - All positions are meters in body- or camera-space as documented per
//!   function; all times are milliseconds; all speeds m/s.

pub mod events;
pub mod filters;
pub mod geometry;
pub mod metrics;
pub mod synthetic;
pub mod types;
