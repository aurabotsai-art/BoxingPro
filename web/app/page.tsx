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

import { beep, bell, speak } from "@/lib/session/audio";
import { DRILLS } from "@/lib/session/drills.gen";
import type { Drill } from "@/lib/session/drills.gen";
import { shareCard } from "@/lib/session/sharecard";
import {
  BONES,
  bucketRounds,
  COMBO_GAP_MS,
  CUE_GAP_MS,
  CUE_SHOW_MS,
  CUE_TEXT,
  GUARD_VIEW,
  GUARD_WARN_SUSTAIN_MS,
  JOINTS,
  MP_TO_CANON,
  PB_SANITY_MPS,
  ROUND_REST_S,
  ROUND_WORK_S,
} from "@/lib/session/model";
import { notationNamed, parseDrillDuration, punchMix, weeklyStats } from "@/lib/session/model";
import type { ComboItem, Hud, LastStrike, RoundStat, StrikeLogItem, Summary, WeekStats } from "@/lib/session/model";
import { coachTip } from "@/lib/session/coach";
import {
  IDB_KEEP,
  idbArchiveKeys,
  idbGetArchive,
  idbSaveArchive,
  loadHistory,
  loadPb,
  ONBOARDED_KEY,
  PB_KEY,
  saveToHistory,
  ROUNDLEN_KEY,
  SOUND_KEY,
  STANCE_KEY,
} from "@/lib/session/storage";

export default function SessionPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(false);
  const [soundOn, setSoundOn] = useState(false);
  const roundAnchorRef = useRef<number | null>(null); // perf.now() when rounds started
  const roundWorkSRef = useRef(ROUND_WORK_S);
  const [roundWorkS, setRoundWorkS] = useState(ROUND_WORK_S);
  const onRoundLen = useCallback((secs: number) => {
    roundWorkSRef.current = secs;
    setRoundWorkS(secs);
    try {
      localStorage.setItem(ROUNDLEN_KEY, String(secs));
    } catch { /* private mode */ }
  }, []);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(ROUNDLEN_KEY));
      if (v === 120 || v === 180) {
        roundWorkSRef.current = v;
        setRoundWorkS(v);
      }
    } catch { /* private mode */ }
  }, []);
  const [roundsOn, setRoundsOn] = useState(false);
  // Guided drill session: round plan comes from the drill's protocol; the
  // HUD loop auto-stops rounds when the planned count completes.
  const drillRef = useRef<{ id: string; name: string; rounds: number } | null>(null);
  const [activeDrill, setActiveDrill] = useState<string | null>(null);
  const onRounds = useCallback(() => {
    setRoundsOn((on) => {
      roundAnchorRef.current = on ? null : performance.now();
      if (on) {
        drillRef.current = null; // manual stop also ends a guided drill
        setActiveDrill(null);
      }
      if (!on && soundOnRef.current && audioRef.current) bell(audioRef.current);
      return !on;
    });
  }, []);
  const onStartDrill = useCallback((d: Drill) => {
    const plan = parseDrillDuration(d.duration);
    if (!plan) return;
    drillRef.current = { id: d.id, name: d.name, rounds: plan.rounds };
    roundWorkSRef.current = plan.workS; // session-scoped override, not persisted
    setRoundWorkS(plan.workS);
    roundAnchorRef.current = performance.now();
    setActiveDrill(d.name);
    setRoundsOn(true);
    setShowSettings(false);
    if (soundOnRef.current) {
      if (audioRef.current) bell(audioRef.current);
      speak(`${d.name}. ${plan.rounds} rounds. ${d.protocol.split(". ")[0]}.`);
    }
  }, []);
  const [hud, setHud] = useState<Hud>({
    status: "starting…",
    fps: 0,
    poseDetected: false,
    strikes: 0,
    last: null,
    profileReady: false,
    elapsed: 0,
    round: null,
    guard: "",
    lowQuality: false,
  });

  const endRef = useRef<(() => void) | null>(null);
  const stanceRef = useRef<"orthodox" | "southpaw">("orthodox");
  const applyStanceRef = useRef<((s: string) => void) | null>(null);
  const [stance, setStance] = useState<"orthodox" | "southpaw">("orthodox");
  const [showSettings, setShowSettings] = useState(false);
  const [past, setPast] = useState<Array<{ s: Summary; hasArchive: boolean }>>([]);
  const [week, setWeek] = useState<WeekStats | null>(null);
  // PWA install: Chrome fires beforeinstallprompt (stash + offer a button);
  // iOS Safari never does — show Share→Add-to-Home-Screen instructions.
  const installEvtRef = useRef<{ prompt: () => Promise<unknown> } | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [iosInstallHint, setIosInstallHint] = useState(false);
  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      installEvtRef.current = e as unknown as { prompt: () => Promise<unknown> };
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIosInstallHint(/iPhone|iPad|iPod/.test(navigator.userAgent) && !standalone);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);
  const onInstall = useCallback(() => {
    installEvtRef.current?.prompt();
    installEvtRef.current = null;
    setCanInstall(false);
  }, []);
  const onOpenSettings = useCallback(() => {
    setShowSettings((v) => {
      if (!v) {
        const history = loadHistory();
        setWeek(history.length ? weeklyStats(history, Date.now()) : null);
        idbArchiveKeys()
          .then((keys) => {
            const set = new Set(keys);
            setPast(history.slice(0, 5).map((s) => ({ s, hasArchive: set.has(s.at) })));
          })
          .catch(() => setPast(history.slice(0, 5).map((s) => ({ s, hasArchive: false }))));
      }
      return !v;
    });
  }, []);
  const onDownloadPast = useCallback(async (at: number) => {
    const archive = await idbGetArchive(at).catch(() => null);
    if (!archive) return;
    const url = URL.createObjectURL(new Blob([archive], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `boxingpro-session-${new Date(at).toISOString().slice(0, 19).replace(/[T:]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, []);
  const pbRef = useRef<number | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARDED_KEY)) setShowOnboarding(true);
    } catch { /* private mode: skip onboarding */ }
  }, []);
  const onOnboarded = useCallback(() => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch { /* private mode */ }
  }, []);
  const [pb, setPb] = useState<number | null>(null);
  const [pbFlash, setPbFlash] = useState<number | null>(null);
  const [comboFlash, setComboFlash] = useState<number | null>(null);
  const switchCameraRef = useRef<((mode: "user" | "environment") => void) | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const onFlipCamera = useCallback(() => {
    setFacing((f) => {
      const next = f === "user" ? "environment" : "user";
      switchCameraRef.current?.(next);
      return next;
    });
  }, []);
  const onStance = useCallback((s: "orthodox" | "southpaw") => {
    stanceRef.current = s;
    setStance(s);
    try {
      localStorage.setItem(STANCE_KEY, s);
    } catch { /* private mode */ }
    applyStanceRef.current?.(s);
  }, []);
  const [summary, setSummary] = useState<{
    current: Summary;
    history: Summary[];
    log: StrikeLogItem[];
    rounds: RoundStat[];
    combos: ComboItem[];
    archiveUrl: string;
    archiveBytes: number;
  } | null>(null);
  const [cue, setCue] = useState<string | null>(null);

  const onReset = useCallback(() => resetRef.current?.(), []);
  const onEnd = useCallback(() => endRef.current?.(), []);
  const onSound = useCallback(() => {
    setSoundOn((on) => {
      if (!on) {
        // Created inside the tap handler so autoplay policy allows it.
        audioRef.current ??= new AudioContext();
        audioRef.current.resume();
        beep(audioRef.current);
      }
      soundOnRef.current = !on;
      try {
        localStorage.setItem(SOUND_KEY, soundOnRef.current ? "1" : "0");
      } catch { /* private mode */ }
      return !on;
    });
  }, []);

  // Restore the saved sound preference. AudioContext still needs a user
  // gesture, so arm a one-time pointer listener that creates it on the first
  // tap anywhere — the toggle reads on immediately, audio unlocks on touch.
  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(SOUND_KEY) === "1";
    } catch { /* private mode */ }
    if (!saved) return;
    soundOnRef.current = true;
    setSoundOn(true);
    const unlock = () => {
      audioRef.current ??= new AudioContext();
      audioRef.current.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;

    // Offline support: after first visit, models/wasm/pages come from cache.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* http or unsupported: app still works online */
      });
    }

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
        try {
          const saved = localStorage.getItem(STANCE_KEY);
          if (saved === "southpaw" || saved === "orthodox") {
            stanceRef.current = saved;
            setStance(saved);
          }
        } catch { /* private mode */ }
        let analyzer = new core.SessionAnalyzer();
        analyzer.set_stance(stanceRef.current);
        applyStanceRef.current = (s) => analyzer.set_stance(s);
        let sessionStart = performance.now();
        let lastStrikes = 0;
        let lastCueAt = -Infinity;
        let lastStrikeAt = -Infinity;
        let comboRun = 0;
        let comboHideTimer: ReturnType<typeof setTimeout> | undefined;
        let lastRoundPhase: "work" | "rest" | null = null;
        let guardRaw = "";
        let guardSince = 0;
        resetRef.current = () => {
          analyzer = new core.SessionAnalyzer();
          analyzer.set_stance(stanceRef.current);
          applyStanceRef.current = (s) => analyzer.set_stance(s);
          sessionStart = performance.now();
          lastStrikes = 0;
          if (roundAnchorRef.current != null) roundAnchorRef.current = performance.now();
          setHud((h) => ({ ...h, strikes: 0, last: null, profileReady: false, elapsed: 0 }));
        };
        endRef.current = () => {
          const s = JSON.parse(analyzer.summary_json()) as Summary;
          s.at = Date.now();
          const log = JSON.parse(analyzer.strikes_json()) as StrikeLogItem[];
          const combos = JSON.parse(analyzer.combos_json()) as ComboItem[];
          // Keypoint archive (SkeletonArchive v1) — the session's raw data,
          // downloadable for film study. Keypoints only, never video.
          const v = videoRef.current;
          const archive = analyzer.archive_json(
            crypto.randomUUID(),
            crypto.randomUUID(),
            "mediapipe-pose-landmarker-full@tasks-vision",
            navigator.userAgent,
            Math.round(fpsWindow.length / 2),
            v?.videoWidth ?? 0,
            v?.videoHeight ?? 0,
          );
          const archiveUrl = URL.createObjectURL(new Blob([archive], { type: "application/json" }));
          // Per-round breakdown: both clocks are performance.now-based, so
          // the rounds anchor maps onto the strike log's session-relative t.
          const rounds =
            roundAnchorRef.current != null
              ? bucketRounds(log, Math.max(0, roundAnchorRef.current - sessionStart), s.duration_ms, roundWorkSRef.current)
              : [];
          const history = s.duration_ms > 5000 ? saveToHistory(s) : [s, ...loadHistory()];
          if (s.duration_ms > 5000) {
            idbSaveArchive(s.at, archive).catch(() => {
              /* private mode / quota: download link still works */
            });
          }
          setSummary({ current: s, history: history.slice(1, 6), log, rounds, combos, archiveUrl, archiveBytes: archive.length });
          resetRef.current?.();
        };

        try {
          await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } })
            .wakeLock?.request("screen");
        } catch { /* screen-dim settings cover unsupported browsers */ }

        pbRef.current = loadPb();
        setPb(pbRef.current);

        setHud((h) => ({ ...h, status: "camera…" }));
        const openCamera = (mode: "user" | "environment") =>
          navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: mode,
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 60 },
            },
            audio: false,
          });
        stream = await openCamera("user");
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        switchCameraRef.current = async (mode) => {
          try {
            const next = await openCamera(mode);
            stream?.getTracks().forEach((t) => t.stop());
            stream = next;
            video.srcObject = next;
            await video.play();
          } catch { /* device without that camera: keep the current one */ }
        };

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        const t0 = performance.now();
        let frames = 0;
        let fpsWindow: number[] = [];
        let poseHits: number[] = [];
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
            if (lm) poseHits.push(now);
            poseHits = poseHits.filter((t) => now - t < 2000);
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
            if (count > lastStrikes) {
              if (soundOnRef.current && audioRef.current) beep(audioRef.current);
              // Live combo run: chained when the previous strike completed
              // within the assembler's 600ms gap (display-side mirror).
              comboRun = now - lastStrikeAt <= COMBO_GAP_MS ? comboRun + (count - lastStrikes) : 1;
              lastStrikeAt = now;
              if (comboRun >= 2) {
                setComboFlash(comboRun);
                clearTimeout(comboHideTimer);
                comboHideTimer = setTimeout(() => setComboFlash(null), 1600);
              }
              // Personal best: sanity-capped so pose glitches can't set it.
              const lastRaw = analyzer.last_strike_json();
              if (lastRaw !== "null") {
                const sp = (JSON.parse(lastRaw) as LastStrike).peak_speed;
                if (sp < PB_SANITY_MPS && (pbRef.current == null || sp > pbRef.current)) {
                  const isFirst = pbRef.current == null;
                  pbRef.current = sp;
                  setPb(sp);
                  try {
                    localStorage.setItem(PB_KEY, String(sp));
                  } catch { /* private mode */ }
                  if (!isFirst) {
                    setPbFlash(sp);
                    setTimeout(() => setPbFlash(null), 2500);
                  }
                }
              }
              // No coaching during rest: punches thrown then are cooldown.
              const anchor = roundAnchorRef.current;
              const cycleS = roundWorkSRef.current + ROUND_REST_S;
              const inRest =
                anchor != null && ((now - anchor) / 1000) % cycleS >= roundWorkSRef.current;
              const cueId = inRest ? "" : analyzer.last_strike_cue();
              if (cueId && now - lastCueAt > CUE_GAP_MS) {
                lastCueAt = now;
                const text = CUE_TEXT[cueId] ?? null;
                setCue(text);
                if (text && soundOnRef.current) speak(text); // eyes-free coaching
                setTimeout(() => setCue(null), CUE_SHOW_MS);
              }
            }
            lastStrikes = count;

            let round: Hud["round"] = null;
            if (roundAnchorRef.current != null) {
              const workS = roundWorkSRef.current;
              const cycS = workS + ROUND_REST_S;
              const rt = (now - roundAnchorRef.current) / 1000;
              const within = rt % cycS;
              const phase: "work" | "rest" = within < workS ? "work" : "rest";
              round = {
                n: Math.floor(rt / cycS) + 1,
                phase,
                remaining: phase === "work" ? workS - within : cycS - within,
              };
              // Guided drill: planned round count done → stop the round
              // clock (session keeps recording; boxer decides what's next).
              const d = drillRef.current;
              if (d && round.n > d.rounds) {
                roundAnchorRef.current = null;
                drillRef.current = null;
                setActiveDrill(null);
                setRoundsOn(false);
                round = null;
                if (soundOnRef.current) {
                  if (audioRef.current) bell(audioRef.current);
                  speak(`${d.name} complete.`);
                }
              }
              if (round && lastRoundPhase !== null && lastRoundPhase !== round.phase && soundOnRef.current && audioRef.current) {
                bell(audioRef.current);
              }
              lastRoundPhase = round ? round.phase : null;
            } else {
              lastRoundPhase = null;
            }

            // Guard: warnings must survive the debounce window; "guard up"
            // shows immediately (a punch drops guard by definition, briefly).
            const g = analyzer.guard_state_now();
            if (g !== guardRaw) {
              guardRaw = g;
              guardSince = now;
            }
            const guardShown =
              g === "both_high" || (g !== "" && now - guardSince > GUARD_WARN_SUSTAIN_MS)
                ? g
                : "";

            // Memory cap reached (~30min @ 30fps): auto-save via End so the
            // session's data is kept instead of silently dropped.
            if (frames % 15 === 0 && analyzer.is_full()) {
              endRef.current?.();
              return void requestAnimationFrame(loop);
            }

            if (frames % 15 === 0) {
              const raw = analyzer.last_strike_json();
              const fps = Math.round(fpsWindow.length / 2);
              const poseRatio = fpsWindow.length > 0 ? poseHits.length / fpsWindow.length : 1;
              // Confidence conditions on measured fps (capture spec): warn
              // when numbers are becoming untrustworthy. Startup grace 5s;
              // fully-absent pose is handled by the 'step into frame' pill.
              const lowQuality =
                (now - sessionStart) / 1000 > 5 &&
                (fps < 18 || (poseHits.length > 0 && poseRatio < 0.7));
              setHud({
                status: "live",
                fps,
                poseDetected: !!lm,
                strikes: count,
                last: raw === "null" ? null : (JSON.parse(raw) as LastStrike),
                profileReady: analyzer.has_profile(),
                elapsed: (now - sessionStart) / 1000,
                round,
                guard: guardShown,
                lowQuality,
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

  // Mirror only the front camera (selfie convention); rear view stays true.
  const mirror = facing === "user" ? ({ transform: "scaleX(-1)" } as const) : {};
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
          {hud.guard && GUARD_VIEW[hud.guard] && (
            <span data-testid="guard" style={pill(GUARD_VIEW[hud.guard][1])}>
              {GUARD_VIEW[hud.guard][0]}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {activeDrill && (
            <span data-testid="drill-pill" style={{ ...pill("#16341fdd"), color: "#7ee08a", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              🥊 {activeDrill}
            </span>
          )}
          <span data-testid="pose" style={pill(hud.poseDetected ? "#16341fdd" : "#3a1a1add")}>
            {hud.poseDetected ? "tracking you" : "step into frame"}
          </span>
          <span
            data-testid="clock"
            style={{
              ...pill(hud.round ? (hud.round.phase === "work" ? "#16341fdd" : "#4a2410dd") : "#1a1c22dd"),
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {hud.round
              ? `R${hud.round.n} ${hud.round.phase === "rest" ? "REST " : ""}${Math.floor(hud.round.remaining / 60)}:${String(Math.floor(hud.round.remaining % 60)).padStart(2, "0")}`
              : `${Math.floor(hud.elapsed / 60)}:${String(Math.floor(hud.elapsed % 60)).padStart(2, "0")}`}
          </span>
          <span data-testid="fps" style={pill(hud.lowQuality ? "#4a2410dd" : "#1a1c22dd")}>{hud.fps} fps</span>
        </div>
      </div>

      {/* bottom stats */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "18px 16px 22px", background: "linear-gradient(transparent, #0a0a0cee 40%)", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 2, color: "#9aa0aa", fontWeight: 700 }}>STRIKES</div>
          <div data-testid="strikes" style={{ fontSize: 64, fontWeight: 900, lineHeight: 1, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
            {hud.strikes}
            {comboFlash != null && (
              <span data-testid="combo" style={{ fontSize: 26, fontWeight: 900, color: "#ffd75e", marginLeft: 10, verticalAlign: "super" }}>
                ×{comboFlash}
              </span>
            )}
          </div>
          {hud.elapsed > 15 && hud.strikes > 0 && (
            <div data-testid="rate" style={{ fontSize: 13, color: "#9aa0aa", fontWeight: 600 }}>
              {Math.round((hud.strikes / hud.elapsed) * 60)} / min
            </div>
          )}
          {pb != null && (
            <div data-testid="pb" style={{ fontSize: 12, color: "#c9a54c", fontWeight: 700 }}>
              best {pb.toFixed(1)} m/s
            </div>
          )}
        </div>

        {hud.last && (
          <div data-testid="last" style={{ textAlign: "right", background: "#14161ccc", border: "1px solid #262a33", borderRadius: 14, padding: "10px 16px", backdropFilter: "blur(8px)" }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700 }}>
              LAST — {hud.last.hand.toUpperCase()}{" "}
              {hud.last.label ? (
                <span style={{ color: hud.last.label === "hook" ? "#e0b87e" : "#7ec8e0" }}>
                  {hud.last.label.toUpperCase()}
                </span>
              ) : (
                "HAND"
              )}
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
            onClick={onOpenSettings}
            data-testid="settings"
            aria-label="settings"
            style={{ background: showSettings ? "#16341fdd" : "#1a1c22dd", color: "#eee", border: "1px solid #2c313c", borderRadius: 12, padding: "10px 14px", fontSize: 16, cursor: "pointer" }}
          >
            ⚙
          </button>
          <button
            onClick={onRounds}
            data-testid="rounds"
            aria-label={roundsOn ? "stop rounds" : "start 3-minute rounds"}
            style={{ background: roundsOn ? "#16341fdd" : "#1a1c22dd", color: "#eee", border: "1px solid #2c313c", borderRadius: 12, padding: "10px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            {roundsOn ? "■ Rounds" : "▶ Rounds"}
          </button>
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
          <button
            onClick={onEnd}
            data-testid="end"
            style={{ background: "#8a1f1fdd", color: "#fff", border: "1px solid #a83232", borderRadius: 12, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            End
          </button>
        </div>
      </div>

      {showSettings && (
        <div
          data-testid="settings-sheet"
          style={{ position: "absolute", right: 16, bottom: 96, background: "#14161c", border: "1px solid #262a33", borderRadius: 14, padding: "14px 16px", width: 240 }}
        >
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, marginBottom: 8 }}>STANCE</div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["orthodox", "southpaw"] as const).map((s) => (
              <button
                key={s}
                onClick={() => onStance(s)}
                data-testid={`stance-${s}`}
                style={{
                  flex: 1,
                  background: stance === s ? "#1d4f2add" : "#1a1c22",
                  color: "#eee",
                  border: `1px solid ${stance === s ? "#2f7a44" : "#2c313c"}`,
                  borderRadius: 10,
                  padding: "9px 0",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "#9aa0aa", marginTop: 8 }}>
            Sets which hand is your lead — guard labels and lead-hand metrics depend on it.
          </div>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "12px 0 8px" }}>ROUND LENGTH</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[120, 180].map((secs) => (
              <button
                key={secs}
                onClick={() => onRoundLen(secs)}
                data-testid={`roundlen-${secs}`}
                style={{
                  flex: 1,
                  background: roundWorkS === secs ? "#1d4f2add" : "#1a1c22",
                  color: "#eee",
                  border: `1px solid ${roundWorkS === secs ? "#2f7a44" : "#2c313c"}`,
                  borderRadius: 10,
                  padding: "9px 0",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {secs / 60}:00{secs === 120 ? " (amateur)" : " (pro)"}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "12px 0 8px" }}>CAMERA</div>
          <button
            onClick={onFlipCamera}
            data-testid="flip-camera"
            style={{ width: "100%", background: "#1a1c22", color: "#eee", border: "1px solid #2c313c", borderRadius: 10, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            🔄 {facing === "user" ? "Front (mirrored)" : "Rear"} — tap to switch
          </button>
          {canInstall && (
            <button
              onClick={onInstall}
              data-testid="install"
              style={{ width: "100%", marginTop: 10, background: "#16341f", color: "#d9f2df", border: "1px solid #2f7a44", borderRadius: 10, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              📲 Install as an app
            </button>
          )}
          {iosInstallHint && !canInstall && (
            <div style={{ fontSize: 11, color: "#9aa0aa", marginTop: 10 }}>
              📲 Install: tap Share, then &quot;Add to Home Screen&quot; — full screen, works offline.
            </div>
          )}
          {week && week.sessions7d > 0 && (
            <>
              <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "12px 0 6px" }}>THIS WEEK</div>
              <div data-testid="week-stats" style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#c6ccd6", fontVariantNumeric: "tabular-nums" }}>
                <span>{week.sessions7d} session{week.sessions7d === 1 ? "" : "s"}</span>
                <span>{week.strikes7d} strikes</span>
                <span>{week.minutes7d} min</span>
                {week.streakDays >= 2 && <span style={{ color: "#ffd75e", fontWeight: 700 }}>🔥 {week.streakDays}-day streak</span>}
              </div>
            </>
          )}
          {(() => {
            // Speed trend across stored sessions (chronological); needs 3+
            // measured points to be worth drawing.
            const pts = past
              .map(({ s }) => s)
              .filter((s) => s.avg_peak_speed != null)
              .reverse();
            if (pts.length < 3) return null;
            const W = 300;
            const H = 40;
            const vMax = Math.max(...pts.map((s) => s.avg_peak_speed as number));
            const vMin = Math.min(...pts.map((s) => s.avg_peak_speed as number));
            const span = Math.max(vMax - vMin, 0.5);
            const xy = (v: number, i: number) =>
              `${(i / (pts.length - 1)) * (W - 8) + 4},${H - 6 - ((v - vMin) / span) * (H - 14)}`;
            return (
              <>
                <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "12px 0 6px" }}>
                  AVG HAND SPEED — LAST {pts.length} SESSIONS
                </div>
                <svg data-testid="trend" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
                  <polyline
                    fill="none"
                    stroke="#61dafb"
                    strokeWidth="1.8"
                    points={pts.map((s, i) => xy(s.avg_peak_speed as number, i)).join(" ")}
                  />
                  <text x={W - 2} y={9} textAnchor="end" fontSize="9" fill="#9aa0aa">
                    {vMax.toFixed(1)} m/s
                  </text>
                  <text x={W - 2} y={H - 1} textAnchor="end" fontSize="9" fill="#565c66">
                    {vMin.toFixed(1)}
                  </text>
                </svg>
              </>
            );
          })()}
          {past.length > 0 && (
            <>
              <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "12px 0 6px" }}>PAST SESSIONS</div>
              <div style={{ maxHeight: 150, overflowY: "auto" }}>
                {past.map(({ s, hasArchive }) => (
                  <div key={s.at} data-testid="past-session" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#c6ccd6", padding: "4px 0" }}>
                    <span>
                      {new Date(s.at).toLocaleDateString()}{" "}
                      {new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {s.strikes_left + s.strikes_right} strikes
                    </span>
                    {hasArchive ? (
                      <button
                        onClick={() => onDownloadPast(s.at)}
                        style={{ background: "none", border: "none", color: "#61dafb", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                      >
                        ⬇ data
                      </button>
                    ) : (
                      <span style={{ color: "#565c66", fontSize: 11 }}>stats only</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "12px 0 6px" }}>
            DRILL LIBRARY ({DRILLS.length})
          </div>
          <div data-testid="drills" style={{ maxHeight: 180, overflowY: "auto" }}>
            {DRILLS.map((d) => (
              <details key={d.id} style={{ padding: "3px 0", fontSize: 13, color: "#c6ccd6" }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                  {d.name} <span style={{ color: "#565c66", fontWeight: 400 }}>· {d.duration}</span>
                </summary>
                <div style={{ padding: "4px 0 6px 14px", color: "#9aa0aa", fontSize: 12, lineHeight: 1.45 }}>
                  {d.protocol}
                  {d.equipment !== "none" && <div style={{ marginTop: 3, color: "#7ec8e0" }}>needs: {d.equipment}</div>}
                  {parseDrillDuration(d.duration) && (
                    <button
                      onClick={() => onStartDrill(d)}
                      data-testid={`drill-start-${d.id}`}
                      style={{ marginTop: 6, background: "#16341f", color: "#7ee08a", border: "1px solid #20624a", borderRadius: 9, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    >
                      ▶ Start drill ({d.duration.split(" ")[0]})
                    </button>
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {showOnboarding && (
        <div
          data-testid="onboarding"
          style={{ position: "absolute", inset: 0, background: "#0a0a0ce6", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 10 }}
        >
          <div style={{ maxWidth: 380, textAlign: "center" }}>
            <div style={{ fontWeight: 800, fontSize: 24, marginBottom: 18 }}>
              <span style={{ color: "#ff4d4d" }}>Boxing</span>Pro
            </div>
            {[
              ["📱", "Prop your phone at chest height — a shelf, tripod, or leaned against a bottle."],
              ["↔️", "Step back until your whole body is in frame (2–3 m works well)."],
              ["🥊", "Face the camera in your stance. Tracking calibrates in the first seconds — stay loose, then let punches go."],
            ].map(([icon, text]) => (
              <div key={text} style={{ display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", margin: "0 0 14px" }}>
                <span style={{ fontSize: 22 }}>{icon}</span>
                <span style={{ fontSize: 15, color: "#c6ccd6", lineHeight: 1.45 }}>{text}</span>
              </div>
            ))}
            <div style={{ fontSize: 12, color: "#9aa0aa", margin: "4px 0 16px" }}>
              Everything runs on your phone. Video never leaves the device.
            </div>
            <button
              onClick={onOnboarded}
              data-testid="onboarding-start"
              style={{ width: "100%", background: "#ff4d4d", color: "#fff", border: "none", borderRadius: 12, padding: "13px 0", fontSize: 16, fontWeight: 800, cursor: "pointer" }}
            >
              Let&apos;s go
            </button>
          </div>
        </div>
      )}

      {pbFlash != null && (
        <div
          data-testid="pb-flash"
          style={{ position: "absolute", top: "32%", left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}
        >
          <span style={{ background: "#3d3007ee", border: "1px solid #c9a54c", color: "#ffe9a8", borderRadius: 14, padding: "12px 22px", fontSize: 22, fontWeight: 900, letterSpacing: 0.5, boxShadow: "0 4px 24px #0008" }}>
            ⚡ NEW BEST — {pbFlash.toFixed(1)} m/s
          </span>
        </div>
      )}

      {cue && (
        <div
          data-testid="cue"
          style={{ position: "absolute", top: "22%", left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}
        >
          <span style={{ background: "#7a3a10ee", border: "1px solid #b25a20", color: "#ffe3cf", borderRadius: 14, padding: "12px 22px", fontSize: 20, fontWeight: 800, letterSpacing: 0.3, boxShadow: "0 4px 24px #0008" }}>
            {cue}
          </span>
        </div>
      )}

      {hud.lowQuality && (
        <div data-testid="quality" style={{ position: "absolute", top: 64, left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
          <span style={{ background: "#4a2410dd", border: "1px solid #7a4420", color: "#ffd9b8", borderRadius: 10, padding: "6px 14px", fontSize: 12, fontWeight: 700 }}>
            ⚠ low tracking quality — add light or step back; speeds may under-read
          </span>
        </div>
      )}

      {!hud.profileReady && hud.status === "live" && (
        <div data-testid="profile" style={{ position: "absolute", bottom: 110, left: 0, right: 0, textAlign: "center", color: "#9aa0aa", fontSize: 13 }}>
          calibrating to your body — keep moving…
        </div>
      )}

      {summary && (
        <div
          data-testid="summary"
          style={{ position: "absolute", inset: 0, background: "#0a0a0cd9", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div style={{ background: "#14161c", border: "1px solid #262a33", borderRadius: 18, padding: "22px 26px", width: "min(420px, 92vw)", maxHeight: "84vh", overflowY: "auto" }}>
            <div style={{ fontSize: 12, letterSpacing: 2, color: "#9aa0aa", fontWeight: 700, marginBottom: 12 }}>SESSION SUMMARY</div>
            {(() => {
              // Deterministic coach card: worst measured fault → one drill
              // (lib/session/coach.ts). Numbers measured, words templated.
              const tip = coachTip(summary.current, summary.log);
              if (tip)
                return (
                  <div data-testid="coach" style={{ background: "#241a10", border: "1px solid #7a4420", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#ffb877", fontWeight: 700, marginBottom: 4 }}>🥊 COACH — WORK ON THIS</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#ffe3cf" }}>{tip.headline}</div>
                    <div style={{ fontSize: 13, color: "#d8c9bd", margin: "4px 0 6px" }}>{tip.fix}</div>
                    <div style={{ fontSize: 12, color: "#ffb877" }}>
                      Drill: <span style={{ fontWeight: 700 }}>{tip.drill}</span>
                    </div>
                    {(() => {
                      const d = DRILLS.find((x) => x.id === tip.drillId);
                      return d ? (
                        <div style={{ fontSize: 11, color: "#b09a8a", marginTop: 3, lineHeight: 1.4 }}>
                          {d.duration} — {d.protocol}
                        </div>
                      ) : null;
                    })()}
                  </div>
                );
              if (summary.log.length >= 5)
                return (
                  <div data-testid="coach" style={{ background: "#10241a", border: "1px solid #20624a", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#7ee08a", fontWeight: 700, marginBottom: 4 }}>🥊 COACH</div>
                    <div style={{ fontSize: 13, color: "#cfe8d4" }}>
                      Clean session — guard returned fast and nothing measurable to fix. Add volume or speed next time.
                    </div>
                  </div>
                );
              return null;
            })()}
            {(() => {
              const s = summary.current;
              const total = s.strikes_left + s.strikes_right;
              const mins = Math.floor(s.duration_ms / 60000);
              const secs = Math.floor((s.duration_ms % 60000) / 1000);
              const row = (label: string, value: string) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #1e222a", fontSize: 15 }}>
                  <span style={{ color: "#9aa0aa" }}>{label}</span>
                  <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</span>
                </div>
              );
              return (
                <>
                  {row("Duration", `${mins}:${String(secs).padStart(2, "0")}`)}
                  {row("Strikes", `${total} (L ${s.strikes_left} / R ${s.strikes_right})`)}
                  {row("Pace", s.strikes_per_min != null ? `${s.strikes_per_min.toFixed(1)} /min` : "—")}
                  {row("Avg hand speed", s.avg_peak_speed != null ? `${s.avg_peak_speed.toFixed(1)} m/s` : "—")}
                  {(s.avg_peak_speed_left != null || s.avg_peak_speed_right != null) &&
                    row(
                      "L / R split",
                      `${s.avg_peak_speed_left != null ? s.avg_peak_speed_left.toFixed(1) : "—"} / ${s.avg_peak_speed_right != null ? s.avg_peak_speed_right.toFixed(1) : "—"} m/s`,
                    )}
                  {row("Fastest", s.max_peak_speed != null ? `${s.max_peak_speed.toFixed(1)} m/s` : "—")}
                  {(() => {
                    const mix = punchMix(summary.log);
                    const named = mix.jab + mix.cross + mix.hook;
                    if (named === 0) return null;
                    const parts = [
                      mix.jab > 0 ? `${mix.jab} jab` : null,
                      mix.cross > 0 ? `${mix.cross} cross` : null,
                      mix.hook > 0 ? `${mix.hook} hook` : null,
                    ].filter(Boolean);
                    return row("Punch mix", parts.join(" · ") + (mix.other > 0 ? ` (+${mix.other} other)` : ""));
                  })()}
                  {row("Avg guard return", s.avg_guard_recovery_ms != null ? `${Math.round(s.avg_guard_recovery_ms)} ms` : "—")}
                  {row("Guard up", s.guard_up_frac != null ? `${Math.round(s.guard_up_frac * 100)}% of the time` : "—")}
                  {s.bounce_cadence_hz != null &&
                    row("Bounce cadence", `${s.bounce_cadence_hz.toFixed(1)} Hz`)}
                  {s.rhythm_predictability != null &&
                    row(
                      "Rhythm predictability",
                      `${Math.round(s.rhythm_predictability * 100)}%${s.rhythm_predictability > 0.75 ? " — timeable, mix it up" : ""}`,
                    )}
                  {s.steps > 0 && row("Steps", `${s.steps}`)}
                  {s.avg_stance_width_m != null &&
                    row(
                      "Stance width",
                      `${s.avg_stance_width_m.toFixed(2)} m avg${s.stance_oob_frac != null && s.stance_oob_frac > 0.25 ? ` · off-base ${Math.round(s.stance_oob_frac * 100)}%` : ""}`,
                    )}
                </>
              );
            })()}
            {summary.rounds.length > 0 && (
              <>
                <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "16px 0 6px" }}>ROUNDS</div>
                {summary.rounds.map((r) => (
                  <div key={r.n} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#c6ccd6", padding: "3px 0", fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ fontWeight: 700 }}>R{r.n}</span>
                    <span>{r.strikes} strikes</span>
                    <span>{r.avgSpeed != null ? `${r.avgSpeed.toFixed(1)} m/s` : "—"}</span>
                    <span style={{ color: r.slowGuard > 0 ? "#ff8a5c" : "#7ee08a" }}>
                      {r.slowGuard > 0 ? `${r.slowGuard} slow guard` : "guard ok"}
                    </span>
                  </div>
                ))}
              </>
            )}
            {summary.log.length >= 3 && (
              <>
                <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "16px 0 6px" }}>
                  HAND SPEED OVER SESSION
                </div>
                {(() => {
                  const W = 360;
                  const H = 46;
                  const tMax = Math.max(summary.current.duration_ms, 1);
                  const vMax = Math.max(...summary.log.map((k) => k.peak_speed), 1);
                  const pt = (k: StrikeLogItem) =>
                    [(k.t_ms / tMax) * W, H - 4 - (k.peak_speed / vMax) * (H - 10)] as const;
                  return (
                    <svg
                      data-testid="sparkline"
                      viewBox={`0 0 ${W} ${H}`}
                      style={{ width: "100%", height: H, display: "block" }}
                    >
                      <polyline
                        fill="none"
                        stroke="#3d4450"
                        strokeWidth="1.5"
                        points={summary.log.map((k) => pt(k).join(",")).join(" ")}
                      />
                      {summary.log.map((k, i) => {
                        const [x, y] = pt(k);
                        return <circle key={i} cx={x} cy={y} r="2.6" fill={k.hand === "left" ? "#61dafb" : "#ffb86c"} />;
                      })}
                      <text x={W - 2} y={10} textAnchor="end" fontSize="9" fill="#9aa0aa">
                        {vMax.toFixed(1)} m/s
                      </text>
                    </svg>
                  );
                })()}
              </>
            )}
            {summary.combos.length > 0 && (
              <>
                <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "16px 0 6px" }}>
                  COMBOS ({summary.combos.length})
                </div>
                <div style={{ maxHeight: 120, overflowY: "auto" }}>
                  {summary.combos.slice(-15).map((c, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#c6ccd6", padding: "3px 0", fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ color: "#9aa0aa" }}>
                        {Math.floor(c.start_ms / 60000)}:{String(Math.floor((c.start_ms % 60000) / 1000)).padStart(2, "0")}
                      </span>
                      <span style={{ fontWeight: 700 }}>
                        {notationNamed(c.notation) ? c.notation : `${c.n}-punch burst`}
                      </span>
                      <span>{Math.round(c.avg_interval_ms)} ms gaps</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {summary.log.length > 0 && (
              <>
                <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "16px 0 6px" }}>
                  STRIKE LOG{summary.log.length > 40 ? ` (last 40 of ${summary.log.length})` : ""}
                </div>
                <div style={{ maxHeight: 180, overflowY: "auto" }}>
                  {summary.log.slice(-40).map((k, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#c6ccd6", padding: "3px 0", fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ color: "#9aa0aa" }}>
                        {Math.floor(k.t_ms / 60000)}:{String(Math.floor((k.t_ms % 60000) / 1000)).padStart(2, "0")}
                      </span>
                      <span style={{ fontWeight: 700, color: k.hand === "left" ? "#61dafb" : "#ffb86c" }}>
                        {k.hand === "left" ? "L" : "R"}
                        {k.label ? ` ${k.label}` : ""}
                      </span>
                      <span>{k.peak_speed.toFixed(1)} m/s</span>
                      <span style={{ color: k.guard_recovery_ms != null && k.guard_recovery_ms > 550 ? "#ff8a5c" : "#7ee08a" }}>
                        {k.guard_recovery_ms != null ? `${Math.round(k.guard_recovery_ms)} ms` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {summary.history.length > 0 && (
              <>
                <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "16px 0 6px" }}>PREVIOUS SESSIONS</div>
                {summary.history.map((h, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#c6ccd6", padding: "4px 0" }}>
                    <span>{new Date(h.at).toLocaleDateString()} {new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {h.strikes_left + h.strikes_right} strikes{h.avg_peak_speed != null ? ` · ${h.avg_peak_speed.toFixed(1)} m/s` : ""}
                    </span>
                  </div>
                ))}
              </>
            )}
            <a
              href={summary.archiveUrl}
              download={`boxingpro-session-${new Date(summary.current.at).toISOString().slice(0, 19).replace(/[T:]/g, "-")}.json`}
              data-testid="export"
              style={{ display: "block", marginTop: 14, textAlign: "center", color: "#61dafb", fontSize: 13, fontWeight: 600, textDecoration: "none" }}
            >
              ⬇ Download keypoint data ({(summary.archiveBytes / 1048576).toFixed(1)} MB) — no video, ever
            </a>
            {summary.current.duration_ms > 5000 && (
              <div style={{ textAlign: "center", fontSize: 11, color: "#9aa0aa", marginTop: 6 }}>
                also kept on this device (last {IDB_KEEP} sessions)
              </div>
            )}
            <button
              onClick={() => shareCard(summary.current, pb).catch(() => {})}
              data-testid="share-card"
              style={{ marginTop: 10, width: "100%", background: "#1a1c22", color: "#eee", border: "1px solid #2c313c", borderRadius: 12, padding: "11px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              📤 Share session card
            </button>
            <button
              onClick={() => {
                URL.revokeObjectURL(summary.archiveUrl);
                setSummary(null);
              }}
              data-testid="close-summary"
              style={{ marginTop: 18, width: "100%", background: "#1a1c22", color: "#eee", border: "1px solid #2c313c", borderRadius: 12, padding: "12px 0", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
            >
              New session
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
