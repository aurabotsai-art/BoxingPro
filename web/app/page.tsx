"use client";

/**
 * Live session v1: camera → MediaPipe pose → Rust Metrics Core (WASM).
 *
 * Analysis consumes WORLD landmarks (true metric 3D, meters, hip-origin) so
 * detector thresholds in m/s are physically meaningful and toward-camera
 * punches register via depth motion. The overlay uses normalized landmarks.
 * View is mirrored (selfie convention).
 */

import { useCallback, useEffect, useRef, useState } from "react";

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

type LastStrike = {
  hand: string;
  peak_speed: number;
  extension_frac: number | null;
  guard_recovery_ms: number | null;
};

type Hud = {
  status: string;
  fps: number;
  poseDetected: boolean;
  strikes: number;
  last: LastStrike | null;
  profileReady: boolean;
  /// Seconds since the camera went live.
  elapsed: number;
};

/** Short percussive blip — confirms a counted strike without looking. */
function beep(ac: AudioContext) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = "square";
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.08, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.08);
  o.connect(g).connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + 0.09);
}

export default function SessionPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(false);
  const [soundOn, setSoundOn] = useState(false);
  const [hud, setHud] = useState<Hud>({
    status: "starting…",
    fps: 0,
    poseDetected: false,
    strikes: 0,
    last: null,
    profileReady: false,
    elapsed: 0,
  });

  const onReset = useCallback(() => resetRef.current?.(), []);
  const onSound = useCallback(() => {
    setSoundOn((on) => {
      if (!on) {
        // Created inside the tap handler so autoplay policy allows it.
        audioRef.current ??= new AudioContext();
        audioRef.current.resume();
        beep(audioRef.current);
      }
      soundOnRef.current = !on;
      return !on;
    });
  }, []);

  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        setHud((h) => ({ ...h, status: "loading models…" }));
        const vision = await import("@mediapipe/tasks-vision");
        const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/models/pose_landmarker_full.task" },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        const core = await import("@/lib/core/boxingpro_core_wasm.js");
        await core.default({ module_or_path: "/core/boxingpro_core_wasm_bg.wasm" });
        let analyzer = new core.SessionAnalyzer();
        let sessionStart = performance.now();
        let lastStrikes = 0;
        resetRef.current = () => {
          analyzer = new core.SessionAnalyzer();
          sessionStart = performance.now();
          lastStrikes = 0;
          setHud((h) => ({ ...h, strikes: 0, last: null, profileReady: false, elapsed: 0 }));
        };

        try {
          await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } })
            .wakeLock?.request("screen");
        } catch { /* screen-dim settings cover unsupported browsers */ }

        setHud((h) => ({ ...h, status: "camera…" }));
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
        const joints = new Float64Array(JOINTS * 4);

        setHud((h) => ({ ...h, status: "live" }));
        sessionStart = performance.now();
        const loop = () => {
          if (stop) return;
          const now = performance.now();
          const tMs = now - t0;
          if (video.readyState >= 2 && video.videoWidth > 0) {
            const res = landmarker.detectForVideo(video, Math.round(tMs));
            frames++;
            fpsWindow.push(now);
            fpsWindow = fpsWindow.filter((t) => now - t < 2000);

            if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
            if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const lm = res.landmarks?.[0];
            const wl = res.worldLandmarks?.[0];
            joints.fill(0);

            if (lm && wl) {
              // ── Analysis: metric world landmarks (y flipped to y-up) ──
              for (const [mp, canon] of MP_TO_CANON) {
                const vis = (lm[mp] as { visibility?: number }).visibility ?? 1;
                if (vis >= 0.5) {
                  joints[canon * 4] = wl[mp].x;
                  joints[canon * 4 + 1] = -wl[mp].y;
                  joints[canon * 4 + 2] = wl[mp].z ?? NaN;
                  joints[canon * 4 + 3] = vis;
                }
              }
              // ── Overlay: normalized landmarks in pixel space ──
              ctx.lineWidth = Math.max(3, canvas.width / 320);
              ctx.strokeStyle = "rgba(97, 218, 251, 0.9)";
              ctx.shadowColor = "rgba(97, 218, 251, 0.6)";
              ctx.shadowBlur = 8;
              const P = (mp: number) => {
                const p = lm[mp];
                const vis = (p as { visibility?: number }).visibility ?? 1;
                return { x: p.x * canvas.width, y: p.y * canvas.height, ok: vis >= 0.5 };
              };
              const mpOf = (canon: number) => MP_TO_CANON.find(([, c]) => c === canon)![0];
              for (const [a, b] of BONES) {
                const pa = P(mpOf(a)), pb = P(mpOf(b));
                if (pa.ok && pb.ok) {
                  ctx.beginPath();
                  ctx.moveTo(pa.x, pa.y);
                  ctx.lineTo(pb.x, pb.y);
                  ctx.stroke();
                }
              }
              ctx.shadowBlur = 0;
              for (const [mp, canon] of MP_TO_CANON) {
                const p = P(mp);
                if (p.ok) {
                  const wristy = canon === 7 || canon === 8;
                  ctx.beginPath();
                  ctx.arc(p.x, p.y, wristy ? 9 : 5, 0, 7);
                  ctx.fillStyle = wristy ? "#ff4d4d" : "#ffffff";
                  ctx.fill();
                }
              }
            }
            analyzer.push_frame(tMs, joints);

            const count = analyzer.strike_count();
            if (count > lastStrikes && soundOnRef.current && audioRef.current) {
              beep(audioRef.current);
            }
            lastStrikes = count;

            if (frames % 15 === 0) {
              const raw = analyzer.last_strike_json();
              setHud({
                status: "live",
                fps: Math.round(fpsWindow.length / 2),
                poseDetected: !!lm,
                strikes: count,
                last: raw === "null" ? null : (JSON.parse(raw) as LastStrike),
                profileReady: analyzer.has_profile(),
                elapsed: (now - sessionStart) / 1000,
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

  const mirror = { transform: "scaleX(-1)" } as const;
  const pill = (bg: string): React.CSSProperties => ({
    padding: "6px 14px",
    borderRadius: 999,
    background: bg,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 0.3,
    backdropFilter: "blur(8px)",
  });

  return (
    <main style={{ position: "fixed", inset: 0, background: "#0a0a0c", overflow: "hidden", fontFamily: "system-ui, sans-serif" }}>
      <video
        ref={videoRef}
        muted
        playsInline
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...mirror }}
      />
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...mirror }}
      />

      {/* top bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "linear-gradient(#0a0a0ccc, transparent)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: 0.5 }}>
            <span style={{ color: "#ff4d4d" }}>Boxing</span>Pro
          </span>
          <span data-testid="status" style={pill(hud.status === "live" ? "#16341fdd" : "#33241add")}>
            {hud.status === "live" ? "● LIVE" : hud.status}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span data-testid="pose" style={pill(hud.poseDetected ? "#16341fdd" : "#3a1a1add")}>
            {hud.poseDetected ? "tracking you" : "step into frame"}
          </span>
          <span data-testid="clock" style={{ ...pill("#1a1c22dd"), fontVariantNumeric: "tabular-nums" }}>
            {Math.floor(hud.elapsed / 60)}:{String(Math.floor(hud.elapsed % 60)).padStart(2, "0")}
          </span>
          <span data-testid="fps" style={pill("#1a1c22dd")}>{hud.fps} fps</span>
        </div>
      </div>

      {/* bottom stats */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "18px 16px 22px", background: "linear-gradient(transparent, #0a0a0cee 40%)", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 2, color: "#9aa0aa", fontWeight: 700 }}>STRIKES</div>
          <div data-testid="strikes" style={{ fontSize: 64, fontWeight: 900, lineHeight: 1, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
            {hud.strikes}
          </div>
          {hud.elapsed > 15 && hud.strikes > 0 && (
            <div data-testid="rate" style={{ fontSize: 13, color: "#9aa0aa", fontWeight: 600 }}>
              {Math.round((hud.strikes / hud.elapsed) * 60)} / min
            </div>
          )}
        </div>

        {hud.last && (
          <div data-testid="last" style={{ textAlign: "right", background: "#14161ccc", border: "1px solid #262a33", borderRadius: 14, padding: "10px 16px", backdropFilter: "blur(8px)" }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700 }}>
              LAST — {hud.last.hand.toUpperCase()} HAND
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#61dafb" }}>
              {hud.last.peak_speed.toFixed(1)} <span style={{ fontSize: 14, color: "#9aa0aa" }}>m/s</span>
            </div>
            {hud.last.guard_recovery_ms != null && (
              <div style={{ fontSize: 13, color: hud.last.guard_recovery_ms > 550 ? "#ff8a5c" : "#7ee08a" }}>
                guard back in {Math.round(hud.last.guard_recovery_ms)} ms
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onSound}
            data-testid="sound"
            aria-label={soundOn ? "mute strike sound" : "enable strike sound"}
            style={{ background: soundOn ? "#16341fdd" : "#1a1c22dd", color: "#eee", border: "1px solid #2c313c", borderRadius: 12, padding: "10px 14px", fontSize: 16, cursor: "pointer" }}
          >
            {soundOn ? "🔊" : "🔇"}
          </button>
          <button
            onClick={onReset}
            data-testid="reset"
            style={{ background: "#1a1c22dd", color: "#eee", border: "1px solid #2c313c", borderRadius: 12, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            Reset
          </button>
        </div>
      </div>

      {!hud.profileReady && hud.status === "live" && (
        <div data-testid="profile" style={{ position: "absolute", bottom: 110, left: 0, right: 0, textAlign: "center", color: "#9aa0aa", fontSize: 13 }}>
          calibrating to your body — keep moving…
        </div>
      )}
    </main>
  );
}
