//! The browser's exported SkeletonArchive must round-trip through the CLI —
//! one contract, every tier (docs/04 §6). This test generates an archive via
//! the same wrapper the web app uses (compiled natively) and runs it through
//! the actual `boxingpro` binary.

use boxingpro_core::synthetic::{jab_sequence, SyntheticJab};
use boxingpro_core::types::JOINT_COUNT;
use boxingpro_core_wasm::SessionAnalyzer;
use std::process::Command;

#[test]
fn app_exported_archive_analyzes_in_the_cli() {
    let jab = SyntheticJab {
        idle_ms: 1200.0,
        ..SyntheticJab::default()
    };
    let seq = jab_sequence(1.8, &jab);

    let mut a = SessionAnalyzer::new();
    let mut buf = vec![0.0; JOINT_COUNT * 4];
    for f in &seq.frames {
        for (i, j) in f.joints.iter().enumerate() {
            let (x, y, z, c) = match j {
                Some(k) => (k.x, k.y, k.z.unwrap_or(f64::NAN), k.confidence),
                None => (0.0, 0.0, f64::NAN, 0.0),
            };
            buf[i * 4] = x;
            buf[i * 4 + 1] = y;
            buf[i * 4 + 2] = z;
            buf[i * 4 + 3] = c;
        }
        a.push_frame(f.t_ms, &buf);
    }
    let archive = a.archive_json(
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "synthetic@test",
        "roundtrip-test",
        60.0,
        1280,
        720,
    );

    let path = std::env::temp_dir().join("bp_app_archive_roundtrip.json");
    std::fs::write(&path, &archive).unwrap();

    let out = Command::new(env!("CARGO_BIN_EXE_boxingpro"))
        .args(["analyze", path.to_str().unwrap()])
        .output()
        .expect("binary runs");
    assert!(
        out.status.success(),
        "analyze failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let v: serde_json::Value = serde_json::from_slice(&out.stdout).expect("valid analysis JSON");
    assert_eq!(v["counts"]["frames"], seq.frames.len());
    assert_eq!(
        v["counts"]["strikes"], 1,
        "the CLI must recover the one jab from the app's archive"
    );
    assert_eq!(v["version"], 1);
}
