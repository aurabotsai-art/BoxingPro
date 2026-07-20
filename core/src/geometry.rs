//! Biomechanics geometry primitives.
//!
//! Pure functions over keypoints. Anything z-dependent takes and returns
//! Option so 2D-only inputs degrade honestly.

use crate::types::{Joint, Keypoint, PoseFrame};

/// Interior angle at vertex `b` formed by segments b→a and b→c, degrees.
/// This is the standard joint-angle definition (e.g. elbow flexion:
/// a=shoulder, b=elbow, c=wrist; full extension ≈ 180°).
pub fn joint_angle_deg(a: Keypoint, b: Keypoint, c: Keypoint) -> f64 {
    let (v1x, v1y) = (a.x - b.x, a.y - b.y);
    let (v2x, v2y) = (c.x - b.x, c.y - b.y);
    let dot = v1x * v2x + v1y * v2y;
    let n1 = (v1x * v1x + v1y * v1y).sqrt();
    let n2 = (v2x * v2x + v2y * v2y).sqrt();
    if n1 == 0.0 || n2 == 0.0 {
        return 0.0;
    }
    (dot / (n1 * n2)).clamp(-1.0, 1.0).acos().to_degrees()
}

pub fn distance(a: Keypoint, b: Keypoint) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

/// Segment mass fractions (Dempster-derived anthropometric tables, adult
/// averages). Good enough for COM *tracking*; absolute COM error is
/// irrelevant because all COM metrics are relative/temporal
/// (docs/03-FEASIBILITY.md §4: weight distribution is T1).
struct Segment {
    proximal: Joint,
    distal: Joint,
    mass_frac: f64,
    /// COM position along proximal→distal.
    com_ratio: f64,
}

const SEGMENTS: &[Segment] = &[
    // Head+neck via ear midpoint proxy handled separately below.
    Segment {
        proximal: Joint::LeftShoulder,
        distal: Joint::LeftElbow,
        mass_frac: 0.028,
        com_ratio: 0.436,
    },
    Segment {
        proximal: Joint::RightShoulder,
        distal: Joint::RightElbow,
        mass_frac: 0.028,
        com_ratio: 0.436,
    },
    Segment {
        proximal: Joint::LeftElbow,
        distal: Joint::LeftWrist,
        mass_frac: 0.022,
        com_ratio: 0.43,
    },
    Segment {
        proximal: Joint::RightElbow,
        distal: Joint::RightWrist,
        mass_frac: 0.022,
        com_ratio: 0.43,
    },
    Segment {
        proximal: Joint::LeftHip,
        distal: Joint::LeftKnee,
        mass_frac: 0.10,
        com_ratio: 0.433,
    },
    Segment {
        proximal: Joint::RightHip,
        distal: Joint::RightKnee,
        mass_frac: 0.10,
        com_ratio: 0.433,
    },
    Segment {
        proximal: Joint::LeftKnee,
        distal: Joint::LeftAnkle,
        mass_frac: 0.0465,
        com_ratio: 0.433,
    },
    Segment {
        proximal: Joint::RightKnee,
        distal: Joint::RightAnkle,
        mass_frac: 0.0465,
        com_ratio: 0.433,
    },
    Segment {
        proximal: Joint::LeftAnkle,
        distal: Joint::LeftToe,
        mass_frac: 0.0145,
        com_ratio: 0.5,
    },
    Segment {
        proximal: Joint::RightAnkle,
        distal: Joint::RightToe,
        mass_frac: 0.0145,
        com_ratio: 0.5,
    },
];

/// Trunk (shoulders↔hips box) ≈ 0.497, head+neck ≈ 0.081 of body mass.
const TRUNK_MASS_FRAC: f64 = 0.497;
const HEAD_MASS_FRAC: f64 = 0.081;

/// Whole-body center of mass in the frame's coordinate space.
/// Returns `None` if the observed mass fraction < `min_mass_frac` —
/// a COM computed from half a body is a lie, not an estimate.
pub fn center_of_mass(frame: &PoseFrame, min_mass_frac: f64) -> Option<(f64, f64)> {
    let mut mx = 0.0;
    let mut my = 0.0;
    let mut m = 0.0;

    for s in SEGMENTS {
        if let (Some(p), Some(d)) = (frame.get(s.proximal), frame.get(s.distal)) {
            let cx = p.x + (d.x - p.x) * s.com_ratio;
            let cy = p.y + (d.y - p.y) * s.com_ratio;
            mx += cx * s.mass_frac;
            my += cy * s.mass_frac;
            m += s.mass_frac;
        }
    }
    // Trunk from shoulder/hip midpoints.
    if let (Some(ls), Some(rs), Some(lh), Some(rh)) = (
        frame.get(Joint::LeftShoulder),
        frame.get(Joint::RightShoulder),
        frame.get(Joint::LeftHip),
        frame.get(Joint::RightHip),
    ) {
        let sx = (ls.x + rs.x) / 2.0;
        let sy = (ls.y + rs.y) / 2.0;
        let hx = (lh.x + rh.x) / 2.0;
        let hy = (lh.y + rh.y) / 2.0;
        // Trunk COM ≈ 50% along hips→shoulders.
        mx += (hx + (sx - hx) * 0.5) * TRUNK_MASS_FRAC;
        my += (hy + (sy - hy) * 0.5) * TRUNK_MASS_FRAC;
        m += TRUNK_MASS_FRAC;
    }
    // Head via nose or ear midpoint.
    let head = frame.get(Joint::Nose).or_else(|| {
        match (frame.get(Joint::LeftEar), frame.get(Joint::RightEar)) {
            (Some(l), Some(r)) => Some(Keypoint {
                x: (l.x + r.x) / 2.0,
                y: (l.y + r.y) / 2.0,
                z: None,
                confidence: l.confidence.min(r.confidence),
            }),
            _ => None,
        }
    });
    if let Some(h) = head {
        mx += h.x * HEAD_MASS_FRAC;
        my += h.y * HEAD_MASS_FRAC;
        m += HEAD_MASS_FRAC;
    }

    if m < min_mass_frac {
        return None;
    }
    Some((mx / m, my / m))
}

/// Front/back weight-distribution proxy: where the COM x sits between the two
/// ankles, 0.0 = fully over rear foot, 1.0 = fully over lead foot.
/// Caller supplies which ankle is the lead. Returns None when feet or COM
/// unobserved, or feet are (nearly) stacked in x — front-on views can't
/// measure this and we say so (docs/03 §4).
pub fn weight_distribution(frame: &PoseFrame, lead_ankle: Joint, rear_ankle: Joint) -> Option<f64> {
    let lead = frame.get(lead_ankle)?;
    let rear = frame.get(rear_ankle)?;
    let (comx, _) = center_of_mass(frame, 0.75)?;
    let span = lead.x - rear.x;
    if span.abs() < 0.15 {
        // < 15 cm apparent stance depth: unmeasurable from this view.
        return None;
    }
    Some(((comx - rear.x) / span).clamp(-0.5, 1.5))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PoseFrame;

    fn kp(x: f64, y: f64) -> Keypoint {
        Keypoint {
            x,
            y,
            z: None,
            confidence: 1.0,
        }
    }

    #[test]
    fn right_angle_measures_90() {
        let a = kp(0.0, 1.0);
        let b = kp(0.0, 0.0);
        let c = kp(1.0, 0.0);
        assert!((joint_angle_deg(a, b, c) - 90.0).abs() < 1e-9);
    }

    #[test]
    fn straight_arm_measures_180() {
        let a = kp(0.0, 0.0);
        let b = kp(0.5, 0.0);
        let c = kp(1.0, 0.0);
        assert!((joint_angle_deg(a, b, c) - 180.0).abs() < 1e-9);
    }

    #[test]
    fn com_refuses_half_a_body() {
        let mut f = PoseFrame::empty(0.0);
        f.set(Joint::LeftShoulder, kp(0.0, 1.5));
        f.set(Joint::LeftElbow, kp(0.1, 1.2));
        assert!(center_of_mass(&f, 0.75).is_none());
    }

    #[test]
    fn com_of_symmetric_standing_body_is_centered() {
        let f = crate::synthetic::standing_frame(0.0, 1.8);
        let (x, _y) = center_of_mass(&f, 0.75).expect("full body should yield COM");
        assert!(x.abs() < 0.02, "COM x {x} should be ~0 for symmetric pose");
    }

    #[test]
    fn weight_distribution_none_when_feet_stacked() {
        let mut f = crate::synthetic::standing_frame(0.0, 1.8);
        // Stack ankles at same x (front-on view of a bladed stance).
        f.set(Joint::LeftAnkle, kp(0.0, 0.05));
        f.set(Joint::RightAnkle, kp(0.01, 0.05));
        assert!(weight_distribution(&f, Joint::LeftAnkle, Joint::RightAnkle).is_none());
    }
}
