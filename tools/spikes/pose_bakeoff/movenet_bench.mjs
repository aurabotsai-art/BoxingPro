// S0.1 pose bake-off, CI half (docs/11, E3): MoveNet via tfjs-node over a
// frame directory. Emits JSON: per-frame latency stats + wrist retention
// (both wrists scored >= threshold). Run MediaPipe over the SAME frames via
// tools/ingest for the comparison column.
//
// Usage: node movenet_bench.mjs <framesDir> <modelType>   # lightning|thunder
// (deps: npm i @tensorflow/tfjs-node @tensorflow-models/pose-detection —
//  installed in the working dir, not the repo)
import * as fs from "fs";
import * as path from "path";
import tf from "@tensorflow/tfjs-node";
import * as poseDetection from "@tensorflow-models/pose-detection";

const [dir, modelType = "lightning"] = process.argv.slice(2);
const CONF = 0.3;

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
const detector = await poseDetection.createDetector(
  poseDetection.SupportedModels.MoveNet,
  {
    modelType:
      modelType === "thunder"
        ? poseDetection.movenet.modelType.SINGLEPOSE_THUNDER
        : poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
  },
);

let wristsOk = 0;
let poseOk = 0;
const times = [];
for (const f of files) {
  const img = tf.node.decodeImage(fs.readFileSync(path.join(dir, f)), 3);
  const t0 = process.hrtime.bigint();
  const poses = await detector.estimatePoses(img);
  times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  img.dispose();
  const kp = poses[0]?.keypoints;
  if (kp) {
    poseOk++;
    const lw = kp.find((k) => k.name === "left_wrist");
    const rw = kp.find((k) => k.name === "right_wrist");
    if ((lw?.score ?? 0) >= CONF && (rw?.score ?? 0) >= CONF) wristsOk++;
  }
}
times.sort((a, b) => a - b);
const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
console.log(
  JSON.stringify({
    model: `movenet-${modelType}`,
    frames: files.length,
    pose_detected_frac: poseOk / files.length,
    both_wrists_frac: wristsOk / files.length,
    latency_ms: { p50: q(0.5), p90: q(0.9), mean: times.reduce((a, b) => a + b, 0) / times.length },
  }),
);
