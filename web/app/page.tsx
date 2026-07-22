"use client";

/**
 * Live session page v0 (docs/04 §4 Tier-1 path, browser edition):
 * camera → MediaPipe PoseLandmarker → canonical 21-joint mapping →
 * Rust Metrics Core (WASM) → live HUD (measured fps, strikes, last-strike
 * metrics) + skeleton overlay.
 *
 * Diagnostics are first-class: this page IS spike S0.2 (capture reality
 * check) when opened on a real phone — the HUD numbers are what the owner
 * reads back (docs/13 M1).
 */

import { useEffect, useRef, useState } from "react";

// MediaPipe landmark index → canonical joint index (mirrors tools/ingest).
const MP_TO_CANON: Array<[number, number]> = [
  [0, 0], [7, 1], [8, 2], [11, 3], [12, 4], [13, 5], [14, 6], [15, 7], [16, 8],
  [23, 9], [24, 10], [25, 11], [26, 12], [27, 13], [28, 14], [29, 15], [30, 16],
  [31, 17], [32, 18],
];
const JOINTS = 21;
const BONES: Array<[number, number]> = [
  [3, 4], [3, 5], [5, 7], [4, 6], [6, 8], [3, 9], [4, 10], [9, 10],
  [9, 11], [11, 13], [10, 12], [12, 14], [13, 15], [15, 17], [14, 16], [16, 18],
];

type Hud = {
  status: string;
  fps: number;
  frames: number;
  poseDetected: boolean;
  strikes: number;
  lastStrike: string | null;
  profileReady: boolean;
};

export default function SessionPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud>({
    status: "initializing…",
    fps: 0,
    frames: 0,
    poseDetected: false,
    strikes: 0,
    lastStrike: null,
    profileReady: false,
  });

  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        setHud((h) => ({ ...h, status: "loading pose model…" }));
        const vision = await import("@mediapipe/tasks-vision");
        const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/models/pose_landmarker_full.task" },
          runningMode: "VIDEO",
          numPoses: 1,
        });

        setHud((h) => ({ ...h, status: "loading metrics core…" }));
        const core = await import("@/lib/core/boxingpro_core_wasm.js");
        await core.default({ module_or_path: "/core/boxingpro_core_wasm_bg.wasm" });
        const analyzer = new core.SessionAnalyzer();

        setHud((h) => ({ ...h, status: "requesting camera…" }));
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
          audio: false,
        });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        const t0 = performance.now();
        let frames = 0;
        let fpsWindow: number[] = [];
        const joints = new Float64Array(JOINTS * 3);

        setHud((h) => ({ ...h, status: "live" }));
        const loop = () => {
          if (stop) return;
          const now = performance.now();
          const tMs = now - t0;
          if (video.readyState >= 2) {
            const res = landmarker.detectForVideo(video, Math.round(tMs));
            frames++;
            fpsWindow.push(now);
            fpsWindow = fpsWindow.filter((t) => now - t < 2000);

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const lm = res.landmarks?.[0];
            joints.fill(0);
            if (lm) {
              const aspect = video.videoWidth / video.videoHeight;
              for (const [mp, canon] of MP_TO_CANON) {
                const p = lm[mp];
                const vis = (p as { visibility?: number }).visibility ?? 1;
                if (vis >= 0.5) {
                  // Canonical space: aspect-corrected, y-up (docs contracts).
                  joints[canon * 3] = p.x * aspect;
                  joints[canon * 3 + 1] = 1 - p.y;
                  joints[canon * 3 + 2] = vis;
                }
              }
              // Overlay in pixel space.
              ctx.strokeStyle = "#4da3ff";
              ctx.lineWidth = 4;
              ctx.fillStyle = "#fff";
              const px = (c: number) => ({
                x: (joints[c * 3] / aspect) * canvas.width,
                y: (1 - joints[c * 3 + 1]) * canvas.height,
                ok: joints[c * 3 + 2] > 0,
              });
              for (const [a, b] of BONES) {
                const pa = px(a), pb = px(b);
                if (pa.ok && pb.ok) {
                  ctx.beginPath();
                  ctx.moveTo(pa.x, pa.y);
                  ctx.lineTo(pb.x, pb.y);
                  ctx.stroke();
                }
              }
              for (const [, canon] of MP_TO_CANON) {
                const p = px(canon);
                if (p.ok) {
                  ctx.beginPath();
                  ctx.arc(p.x, p.y, canon === 7 || canon === 8 ? 8 : 5, 0, 7);
                  ctx.fillStyle = canon === 7 || canon === 8 ? "#ff5555" : "#fff";
                  ctx.fill();
                }
              }
            }
            analyzer.push_frame(tMs, joints);

            if (frames % 15 === 0) {
              const last = analyzer.last_strike_json();
              setHud({
                status: "live",
                fps: Math.round((fpsWindow.length / 2) * 10) / 10,
                frames,
                poseDetected: !!lm,
                strikes: analyzer.strike_count(),
                lastStrike: last === "null" ? null : last,
                profileReady: analyzer.has_profile(),
              });
            }
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      } catch (e) {
        setHud((h) => ({ ...h, status: `error: ${e instanceof Error ? e.message : e}` }));
      }
    })();

    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ position: "relative", flex: 1, background: "#000" }}>
        <video ref={videoRef} muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
      <div id="hud" data-testid="hud" style={{ padding: "10px 14px", background: "#1a1a1a", fontSize: 14, display: "flex", gap: 18, flexWrap: "wrap" }}>
        <span data-testid="status">{hud.status}</span>
        <span data-testid="fps">fps: {hud.fps}</span>
        <span data-testid="frames">frames: {hud.frames}</span>
        <span data-testid="pose">pose: {hud.poseDetected ? "✓" : "–"}</span>
        <span data-testid="strikes">strikes: {hud.strikes}</span>
        <span data-testid="profile">profile: {hud.profileReady ? "auto" : "building…"}</span>
        {hud.lastStrike && <span data-testid="last">last: {hud.lastStrike}</span>}
      </div>
    </main>
  );
}
