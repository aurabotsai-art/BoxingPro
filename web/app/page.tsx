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
  straightness: number | null;
  /** "straight" | "curved" | null — coarse path geometry, not punch class. */
  shape: string | null;
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
  /// Round-timer state, or null in freestyle mode.
  round: { n: number; phase: "work" | "rest"; remaining: number } | null;
  /// Debounced guard state id ("" = unknown/unprofiled).
  guard: string;
};

const ROUND_WORK_S = 180;
const ROUND_REST_S = 60;
const ROUND_CYCLE_S = ROUND_WORK_S + ROUND_REST_S;

type Summary = {
  duration_ms: number;
  strikes_left: number;
  strikes_right: number;
  avg_peak_speed: number | null;
  avg_peak_speed_left: number | null;
  avg_peak_speed_right: number | null;
  max_peak_speed: number | null;
  avg_guard_recovery_ms: number | null;
  strikes_per_min: number | null;
  guard_up_frac: number | null;
  /** Epoch ms; stamped when saved to history. */
  at: number;
};

/** Guard pill: id → [label, background]. Warnings only after sustained drop. */
const GUARD_VIEW: Record<string, [string, string]> = {
  both_high: ["guard up", "#16341fdd"],
  lead_down: ["lead hand low", "#4a2410dd"],
  rear_down: ["rear hand low", "#4a2410dd"],
  both_down: ["hands low!", "#4a1010dd"],
};
const GUARD_WARN_SUSTAIN_MS = 800;
/** Chain gap for the live combo indicator — matches the core assembler's
 *  600ms apex-gap rule (core/src/combos.rs via combos_json). */
const COMBO_GAP_MS = 600;
const STANCE_KEY = "boxingpro.stance.v1";
const PB_KEY = "boxingpro.pb.v1";
const ONBOARDED_KEY = "boxingpro.onboarded.v1";
/** Speeds above this are pose glitches (elite hands top out ~13 m/s), not PBs. */
const PB_SANITY_MPS = 15;

/** On-device archive store: last N session keypoint archives in IndexedDB
 *  (localStorage is too small — a 30-min archive is ~18MB). Best-effort:
 *  private mode / quota errors never break the session flow. */
const IDB_NAME = "boxingpro";
const IDB_STORE = "archives";
const IDB_KEEP = 5;

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE, { keyPath: "at" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSaveArchive(at: number, archive: string): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put({ at, archive });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  // Prune oldest beyond the keep limit.
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const excess = (keys as number[]).sort((a, b) => a - b).slice(0, Math.max(0, keys.length - IDB_KEEP));
  if (excess.length) {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      for (const k of excess) tx.objectStore(IDB_STORE).delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  db.close();
}

async function idbArchiveKeys(): Promise<number[]> {
  const db = await idbOpen();
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return (keys as number[]).sort((a, b) => b - a);
}

async function idbGetArchive(at: number): Promise<string | null> {
  const db = await idbOpen();
  const rec = await new Promise<{ archive?: string } | undefined>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(at);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rec?.archive ?? null;
}

function loadPb(): number | null {
  try {
    const v = Number(localStorage.getItem(PB_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

type StrikeLogItem = {
  t_ms: number;
  hand: string;
  peak_speed: number;
  guard_recovery_ms: number | null;
};

type ComboItem = { start_ms: number; n: number; avg_interval_ms: number };

type RoundStat = {
  n: number; // 1-based round number
  strikes: number;
  avgSpeed: number | null;
  slowGuard: number; // strikes with recovery > 550ms
};

/** Bucket work-phase strikes into rounds. offsetMs = rounds start relative
 *  to the session clock; strikes before it (or in rest) are not counted. */
function bucketRounds(log: StrikeLogItem[], offsetMs: number, durationMs: number): RoundStat[] {
  const cycle = ROUND_CYCLE_S * 1000;
  const work = ROUND_WORK_S * 1000;
  const count = Math.max(1, Math.floor(Math.max(0, durationMs - offsetMs) / cycle) + 1);
  const rounds: RoundStat[] = Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    strikes: 0,
    avgSpeed: null,
    slowGuard: 0,
  }));
  const speeds: number[][] = rounds.map(() => []);
  for (const k of log) {
    const rel = k.t_ms - offsetMs;
    if (rel < 0) continue;
    const n = Math.floor(rel / cycle);
    if (n >= rounds.length || rel % cycle >= work) continue;
    rounds[n].strikes++;
    speeds[n].push(k.peak_speed);
    if (k.guard_recovery_ms != null && k.guard_recovery_ms > 550) rounds[n].slowGuard++;
  }
  rounds.forEach((r, i) => {
    if (speeds[i].length) r.avgSpeed = speeds[i].reduce((a, b) => a + b, 0) / speeds[i].length;
  });
  return rounds;
}

const HISTORY_KEY = "boxingpro.sessions.v1";

/** Cue id (from the Metrics Core fault layer) → words. One cue at a time. */
const CUE_TEXT: Record<string, string> = {
  hands_drop_after_punch: "Hands back to guard faster",
  overextension: "Don't overreach — stay inside your range",
};
const CUE_SHOW_MS = 2800;
const CUE_GAP_MS = 6000;

function loadHistory(): Summary[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as Summary[];
  } catch {
    return [];
  }
}

function saveToHistory(s: Summary): Summary[] {
  const all = [s, ...loadHistory()].slice(0, 20);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  } catch { /* quota/private mode: history is best-effort */ }
  return all;
}

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

/** Two-tone bell for round start/end. */
function bell(ac: AudioContext) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(660, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(440, ac.currentTime + 0.4);
  g.gain.setValueAtTime(0.18, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);
  o.connect(g).connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + 0.65);
}

export default function SessionPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(false);
  const [soundOn, setSoundOn] = useState(false);
  const roundAnchorRef = useRef<number | null>(null); // perf.now() when rounds started
  const [roundsOn, setRoundsOn] = useState(false);
  const onRounds = useCallback(() => {
    setRoundsOn((on) => {
      roundAnchorRef.current = on ? null : performance.now();
      if (!on && soundOnRef.current && audioRef.current) bell(audioRef.current);
      return !on;
    });
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
  });

  const endRef = useRef<(() => void) | null>(null);
  const stanceRef = useRef<"orthodox" | "southpaw">("orthodox");
  const applyStanceRef = useRef<((s: string) => void) | null>(null);
  const [stance, setStance] = useState<"orthodox" | "southpaw">("orthodox");
  const [showSettings, setShowSettings] = useState(false);
  const [past, setPast] = useState<Array<{ s: Summary; hasArchive: boolean }>>([]);
  const onOpenSettings = useCallback(() => {
    setShowSettings((v) => {
      if (!v) {
        const history = loadHistory();
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
      return !on;
    });
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
              ? bucketRounds(log, Math.max(0, roundAnchorRef.current - sessionStart), s.duration_ms)
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
              const inRest =
                anchor != null && ((now - anchor) / 1000) % ROUND_CYCLE_S >= ROUND_WORK_S;
              const cueId = inRest ? "" : analyzer.last_strike_cue();
              if (cueId && now - lastCueAt > CUE_GAP_MS) {
                lastCueAt = now;
                setCue(CUE_TEXT[cueId] ?? null);
                setTimeout(() => setCue(null), CUE_SHOW_MS);
              }
            }
            lastStrikes = count;

            let round: Hud["round"] = null;
            if (roundAnchorRef.current != null) {
              const rt = (now - roundAnchorRef.current) / 1000;
              const within = rt % ROUND_CYCLE_S;
              const phase: "work" | "rest" = within < ROUND_WORK_S ? "work" : "rest";
              round = {
                n: Math.floor(rt / ROUND_CYCLE_S) + 1,
                phase,
                remaining: phase === "work" ? ROUND_WORK_S - within : ROUND_CYCLE_S - within,
              };
              if (lastRoundPhase !== null && lastRoundPhase !== phase && soundOnRef.current && audioRef.current) {
                bell(audioRef.current);
              }
              lastRoundPhase = phase;
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
              setHud({
                status: "live",
                fps: Math.round(fpsWindow.length / 2),
                poseDetected: !!lm,
                strikes: count,
                last: raw === "null" ? null : (JSON.parse(raw) as LastStrike),
                profileReady: analyzer.has_profile(),
                elapsed: (now - sessionStart) / 1000,
                round,
                guard: guardShown,
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
          <span data-testid="fps" style={pill("#1a1c22dd")}>{hud.fps} fps</span>
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
              LAST — {hud.last.hand.toUpperCase()} HAND
              {hud.last.shape && (
                <span style={{ color: hud.last.shape === "straight" ? "#7ec8e0" : "#e0b87e", marginLeft: 6 }}>
                  · {hud.last.shape.toUpperCase()}
                </span>
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
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa0aa", fontWeight: 700, margin: "12px 0 8px" }}>CAMERA</div>
          <button
            onClick={onFlipCamera}
            data-testid="flip-camera"
            style={{ width: "100%", background: "#1a1c22", color: "#eee", border: "1px solid #2c313c", borderRadius: 10, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            🔄 {facing === "user" ? "Front (mirrored)" : "Rear"} — tap to switch
          </button>
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
                  {row("Avg guard return", s.avg_guard_recovery_ms != null ? `${Math.round(s.avg_guard_recovery_ms)} ms` : "—")}
                  {row("Guard up", s.guard_up_frac != null ? `${Math.round(s.guard_up_frac * 100)}% of the time` : "—")}
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
                      <span style={{ fontWeight: 700 }}>{c.n}-punch burst</span>
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
