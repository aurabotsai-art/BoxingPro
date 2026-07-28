//! BoxingPro analysis CLI.
//!
//! `boxingpro analyze <archive.json>` — SkeletonArchive v1 in, analysis JSON
//! out (stdout). Runs the real pipeline: events → per-strike metrics →
//! fault primitives, all via the shared Metrics Core. For uncalibrated
//! archives (YouTube ingests) it derives an auto body profile from the data
//! itself and stamps the output `profile: "auto_uncalibrated"` so downstream
//! consumers know these are relative, not calibrated, numbers.

use boxingpro_core::events::{detect_strikes, DetectorConfig, Hand};
use boxingpro_core::faults::{
    detect_hands_drop, detect_overextension, FaultThresholds, StrikeRecord,
};
use boxingpro_core::metrics::{strike_metrics, MetricsConfig};
use boxingpro_core::types::{
    BodyProfile, Joint, Keypoint, PoseFrame, Sequence, Stance, StrikeClass, JOINT_COUNT,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct ArchiveJson {
    version: u32,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    capture: Value,
    frames: Vec<FrameJson>,
}

#[derive(Deserialize)]
struct FrameJson {
    t_ms: f64,
    joints: Vec<Option<JointJson>>,
}

#[derive(Deserialize)]
struct JointJson {
    x: f64,
    y: f64,
    #[serde(default)]
    z: Option<f64>,
    c: f64,
}

fn to_sequence(a: &ArchiveJson) -> Sequence {
    let mut frames = Vec::with_capacity(a.frames.len());
    for f in &a.frames {
        let mut pf = PoseFrame::empty(f.t_ms);
        for (i, j) in f.joints.iter().enumerate().take(JOINT_COUNT) {
            if let Some(j) = j {
                pf.joints[i] = Some(Keypoint {
                    x: j.x,
                    y: j.y,
                    z: j.z,
                    confidence: j.c,
                });
            }
        }
        frames.push(pf);
    }
    Sequence { frames }
}

/// Median of a non-empty slice (copies; fine at CLI scale).
fn median(mut v: Vec<f64>) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    Some(v[v.len() / 2])
}

fn percentile(mut v: Vec<f64>, p: f64) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let idx = ((v.len() - 1) as f64 * p).round() as usize;
    Some(v[idx])
}

/// Derive an auto body profile from an uncalibrated sequence: arm length from
/// near-max observed wrist↔shoulder distance, guard position from median
/// wrist location, stance from which foot leads (dominant forward ankle).
/// Honest by construction: works in whatever space the archive is in.
fn auto_profile(seq: &Sequence) -> Option<BodyProfile> {
    let mut reach_l = Vec::new();
    let mut reach_r = Vec::new();
    let mut wrists_l = (Vec::new(), Vec::new());
    let mut wrists_r = (Vec::new(), Vec::new());
    let mut shoulder_w = Vec::new();
    let mut ankle_dx = Vec::new();
    let mut heights = Vec::new();

    for f in &seq.frames {
        if let (Some(ls), Some(rs)) = (f.get(Joint::LeftShoulder), f.get(Joint::RightShoulder)) {
            shoulder_w.push(((ls.x - rs.x).powi(2) + (ls.y - rs.y).powi(2)).sqrt());
            if let Some(lw) = f.get(Joint::LeftWrist) {
                reach_l.push(((lw.x - ls.x).powi(2) + (lw.y - ls.y).powi(2)).sqrt());
                wrists_l.0.push(lw.x);
                wrists_l.1.push(lw.y);
            }
            if let Some(rw) = f.get(Joint::RightWrist) {
                reach_r.push(((rw.x - rs.x).powi(2) + (rw.y - rs.y).powi(2)).sqrt());
                wrists_r.0.push(rw.x);
                wrists_r.1.push(rw.y);
            }
        }
        if let (Some(la), Some(ra)) = (f.get(Joint::LeftAnkle), f.get(Joint::RightAnkle)) {
            ankle_dx.push(la.x - ra.x);
        }
        if let (Some(n), Some(a)) = (f.get(Joint::Nose), f.get(Joint::LeftAnkle)) {
            heights.push((n.y - a.y).abs() / 0.88); // nose ≈ 88% of stature
        }
    }

    let arm = percentile(reach_l.clone(), 0.95)
        .into_iter()
        .chain(percentile(reach_r.clone(), 0.95))
        .fold(f64::MIN, f64::max);
    if arm <= 0.0 {
        return None;
    }
    // Lead side: the ankle that sits farther in the median movement direction
    // is ambiguous without an opponent; default orthodox unless right ankle
    // clearly leads (in image space, mirroring is unknowable — stance mainly
    // affects lead/rear labeling, and we surface it in the output).
    let stance = match median(ankle_dx) {
        Some(dx) if dx < -0.05 => Stance::Southpaw,
        _ => Stance::Orthodox,
    };
    Some(BodyProfile {
        height_m: median(heights).unwrap_or(1.75),
        arm_length_m: arm,
        shoulder_width_m: median(shoulder_w).unwrap_or(arm * 0.65),
        stance,
        guard_left: [
            median(wrists_l.0).unwrap_or(0.0),
            median(wrists_l.1).unwrap_or(0.0),
        ],
        guard_right: [
            median(wrists_r.0).unwrap_or(0.0),
            median(wrists_r.1).unwrap_or(0.0),
        ],
    })
}

fn analyze(archive_path: &str) -> Result<Value, String> {
    let raw = std::fs::read_to_string(archive_path).map_err(|e| format!("read: {e}"))?;
    let archive: ArchiveJson = serde_json::from_str(&raw).map_err(|e| format!("parse: {e}"))?;
    if archive.version != 1 {
        return Err(format!("unsupported archive version {}", archive.version));
    }
    let seq = to_sequence(&archive);
    let profile = auto_profile(&seq).ok_or("too little observed body data for auto-profile")?;

    let det = DetectorConfig::default();
    let met = MetricsConfig::default();
    let mut events = Vec::new();
    let mut records = Vec::new();

    for hand in [Hand::Left, Hand::Right] {
        for c in detect_strikes(&seq, hand, &det) {
            let m = strike_metrics(&seq, &c, &profile, &met);
            let apex_t = seq.frames[c.peak_idx].t_ms;
            events.push(json!({
                "id": format!("ev-{}-{}", if hand == Hand::Left { "l" } else { "r" }, c.peak_idx),
                "kind": "strike",
                "hand": if c.hand == Hand::Left { "left" } else { "right" },
                "t_start_ms": seq.frames[c.onset_idx].t_ms,
                "t_end_ms": seq.frames[c.end_idx.min(seq.frames.len()-1)].t_ms,
                "t_apex_ms": apex_t,
                "class": "unclassified_strike",   // classifier not in the loop yet
                "metrics": {
                    "peak_speed": {"value": m.peak_speed_mps, "tier": "T1"},
                    "extension_frac": m.extension_frac.map(|v| json!({"value": v, "tier": "T0"})),
                    "straightness": m.straightness.map(|v| json!({"value": v, "tier": "T1"})),
                    "guard_recovery_ms": m.guard_recovery_ms.map(|v| json!({"value": v, "tier": "T0"})),
                }
            }));
            records.push(StrikeRecord {
                t_apex_ms: apex_t,
                class: StrikeClass::Unclassified,
                metrics: m,
            });
        }
    }
    records.sort_by(|a, b| a.t_apex_ms.partial_cmp(&b.t_apex_ms).unwrap());

    let th = FaultThresholds::default();
    let mut faults = Vec::new();
    for f in [
        detect_hands_drop(&records, &th),
        detect_overextension(&records, &th),
    ]
    .into_iter()
    .flatten()
    {
        faults.push(json!({
            "fault_id": f.fault_id,
            "frequency": f.frequency,
            "evidence_t_ms": f.evidence_t_ms,
        }));
    }

    Ok(json!({
        "version": 1,
        "session_id": archive.session_id,
        "tier": "deep_lite",
        "profile": "auto_uncalibrated",
        "profile_derived": {
            "arm_length": profile.arm_length_m,
            "shoulder_width": profile.shoulder_width_m,
            "stance_guess": if profile.stance == Stance::Orthodox { "orthodox" } else { "southpaw" },
        },
        "capture": archive.capture,
        "pipeline_versions": {
            "metrics_core": env!("CARGO_PKG_VERSION"),
            "classifier": "none",
            "fault_taxonomy": "seed-v0",
        },
        "counts": { "strikes": events.len(), "frames": seq.frames.len(),
                     "duration_ms": seq.duration_ms() },
        "aggregates": aggregates(&records, seq.duration_ms()),
        "events": events,
        "faults": faults,
    }))
}

/// Session-level rollups in the contract's measurement shape
/// (value/unit/tier[/confidence]); the schema requires this block and the
/// coach layer keys drills off it.
fn aggregates(records: &[StrikeRecord], duration_ms: f64) -> Value {
    let speeds: Vec<f64> = records.iter().map(|r| r.metrics.peak_speed_mps).collect();
    let mut agg = serde_json::Map::new();
    agg.insert(
        "strike_count".into(),
        json!({"value": records.len(), "unit": null, "tier": "T0"}),
    );
    agg.insert(
        "duration_s".into(),
        json!({"value": duration_ms / 1000.0, "unit": "s", "tier": "T0"}),
    );
    if duration_ms > 1000.0 {
        agg.insert(
            "strikes_per_min".into(),
            json!({"value": records.len() as f64 / (duration_ms / 60_000.0),
                   "unit": null, "tier": "T0"}),
        );
    }
    if !speeds.is_empty() {
        let avg = speeds.iter().sum::<f64>() / speeds.len() as f64;
        let max = speeds.iter().cloned().fold(f64::MIN, f64::max);
        agg.insert(
            "avg_peak_hand_speed".into(),
            json!({"value": avg, "unit": "m/s", "tier": "T1"}),
        );
        agg.insert(
            "max_peak_hand_speed".into(),
            json!({"value": max, "unit": "m/s", "tier": "T1"}),
        );
    }
    Value::Object(agg)
}

/// Emit a synthetic single-jab SkeletonArchive (known ground truth) — lets
/// anyone test `analyze` and downstream tooling without footage.
/// `fps`/`height` vary the kinematics for training-pipeline dry runs.
fn synth_jab(fps: f64, height: f64) -> Value {
    use boxingpro_core::synthetic::{jab_sequence, SyntheticJab};
    let p = SyntheticJab {
        fps,
        ..SyntheticJab::default()
    };
    let seq = jab_sequence(height, &p);
    archive_json(
        &seq,
        fps,
        json!({ "expected_peak_speed_mps": p.expected_peak_speed_mps() }),
    )
}

/// Emit a synthetic single-lead-hook SkeletonArchive (arced path — the
/// straightness contrast class for classifier dry runs).
fn synth_hook(fps: f64, height: f64) -> Value {
    use boxingpro_core::synthetic::{hook_sequence, SyntheticHook};
    let p = SyntheticHook {
        fps,
        ..SyntheticHook::default()
    };
    let seq = hook_sequence(height, &p);
    archive_json(&seq, fps, json!({ "class": "lead_hook" }))
}

fn archive_json(seq: &boxingpro_core::types::Sequence, fps: f64, truth: Value) -> Value {
    let frames: Vec<Value> = seq
        .frames
        .iter()
        .map(|f| {
            let joints: Vec<Value> = f
                .joints
                .iter()
                .map(|j| match j {
                    Some(k) => json!({"x": k.x, "y": k.y, "z": k.z, "c": k.confidence}),
                    None => Value::Null,
                })
                .collect();
            json!({"t_ms": f.t_ms, "joints": joints})
        })
        .collect();
    json!({
        "version": 1,
        "session_id": "00000000-0000-0000-0000-00000000beef",
        "capture": {
            "fps_nominal": fps, "width": 0, "height": 0,
            "pose_model_id": "synthetic", "device_model": "synthetic",
        },
        "calibration_ref": {
            "body_profile_id": "00000000-0000-0000-0000-00000000cafe",
            "scale_anchor": "user_stated",
        },
        "coordinate_space": "camera_metric",
        "synthetic_truth": truth,
        "frames": frames,
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("analyze") if args.len() == 3 => match analyze(&args[2]) {
            Ok(v) => println!("{}", serde_json::to_string_pretty(&v).unwrap()),
            Err(e) => {
                eprintln!("error: {e}");
                std::process::exit(1);
            }
        },
        Some(cmd @ ("synth-jab" | "synth-hook")) => {
            let fps = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(60.0);
            let height = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1.8);
            let v = if cmd == "synth-jab" {
                synth_jab(fps, height)
            } else {
                synth_hook(fps, height)
            };
            println!("{}", serde_json::to_string(&v).unwrap());
        }
        _ => {
            eprintln!(
                "usage: boxingpro analyze <skeleton_archive.json> | boxingpro synth-jab [fps] [height] | boxingpro synth-hook [fps] [height]"
            );
            std::process::exit(2);
        }
    }
}
