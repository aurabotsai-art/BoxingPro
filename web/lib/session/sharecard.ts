/** Shareable session card: canvas-rendered stats image (1080×1080). Uses the
 *  Web Share API with files on mobile (share sheet), falls back to a PNG
 *  download. Keypoint data stays out — the card is stats only. */

import { punchMix } from "./model";
import type { ComboItem, StrikeLogItem, Summary } from "./model";
import { notationNamed } from "./model";

/** Extra card content derived from the strike log/combos (all optional —
 *  the card renders fine for stats-only history entries). */
export type CardExtras = {
  log?: StrikeLogItem[];
  combos?: ComboItem[];
};

/** Longest combo with a nameable notation, else longest combo. */
export function bestCombo(combos: ComboItem[]): ComboItem | null {
  if (!combos.length) return null;
  const named = combos.filter((c) => notationNamed(c.notation));
  const pool = named.length ? named : combos;
  return pool.reduce((a, b) => (b.n > a.n ? b : a));
}

function line(ctx: CanvasRenderingContext2D, label: string, value: string, y: number) {
  ctx.textAlign = "left";
  ctx.fillStyle = "#9aa0aa";
  ctx.font = "600 34px system-ui, sans-serif";
  ctx.fillText(label.toUpperCase(), 90, y);
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 40px system-ui, sans-serif";
  ctx.fillText(value, 990, y);
}

export function drawSessionCard(s: Summary, pb: number | null, extras: CardExtras = {}): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1080;
  const ctx = c.getContext("2d")!;

  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, 1080, 1080);
  const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
  grad.addColorStop(0, "#1a0c0c");
  grad.addColorStop(1, "#0a0a0c");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1080);

  ctx.textAlign = "left";
  ctx.font = "900 64px system-ui, sans-serif";
  ctx.fillStyle = "#ff4d4d";
  ctx.fillText("Boxing", 90, 130);
  const w = ctx.measureText("Boxing").width;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("Pro", 90 + w, 130);
  ctx.font = "600 30px system-ui, sans-serif";
  ctx.fillStyle = "#9aa0aa";
  ctx.fillText(new Date(s.at).toLocaleDateString(), 90, 185);

  const total = s.strikes_left + s.strikes_right;
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 220px system-ui, sans-serif";
  ctx.fillText(String(total), 90, 430);
  ctx.font = "700 40px system-ui, sans-serif";
  ctx.fillStyle = "#9aa0aa";
  ctx.fillText("STRIKES", 95, 490);

  const mins = Math.floor(s.duration_ms / 60000);
  const secs = Math.floor((s.duration_ms % 60000) / 1000);
  let y = 610;
  const rows: Array<[string, string]> = [
    ["Duration", `${mins}:${String(secs).padStart(2, "0")}`],
    ["L / R split", `${s.strikes_left} / ${s.strikes_right}`],
  ];
  if (s.avg_peak_speed != null) rows.push(["Avg hand speed", `${s.avg_peak_speed.toFixed(1)} m/s`]);
  if (s.max_peak_speed != null) rows.push(["Fastest", `${s.max_peak_speed.toFixed(1)} m/s`]);
  if (s.strikes_per_min != null) rows.push(["Pace", `${s.strikes_per_min.toFixed(1)} /min`]);
  if (s.guard_up_frac != null) rows.push(["Guard up", `${Math.round(s.guard_up_frac * 100)}%`]);
  if (extras.log?.length) {
    const mix = punchMix(extras.log);
    if (mix.jab + mix.cross + mix.hook + mix.uppercut > 0) {
      const parts = [
        mix.jab > 0 ? `${mix.jab}J` : null,
        mix.cross > 0 ? `${mix.cross}C` : null,
        mix.hook > 0 ? `${mix.hook}H` : null,
        mix.uppercut > 0 ? `${mix.uppercut}U` : null,
      ].filter(Boolean);
      rows.push(["Punch mix", parts.join(" · ")]);
    }
  }
  const top = extras.combos ? bestCombo(extras.combos) : null;
  if (top && notationNamed(top.notation)) rows.push(["Best combo", top.notation as string]);
  if (pb != null) rows.push(["All-time best", `${pb.toFixed(1)} m/s`]);
  for (const [label, value] of rows.slice(0, 7)) {
    line(ctx, label, value, y);
    ctx.strokeStyle = "#22262e";
    ctx.beginPath();
    ctx.moveTo(90, y + 24);
    ctx.lineTo(990, y + 24);
    ctx.stroke();
    y += 74;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#565c66";
  ctx.font = "600 28px system-ui, sans-serif";
  ctx.fillText("boxing-pro.vercel.app — AI coach, camera only", 540, 1030);
  return c;
}

export async function shareCard(s: Summary, pb: number | null, extras: CardExtras = {}): Promise<void> {
  const canvas = drawSessionCard(s, pb, extras);
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
  );
  const file = new File([blob], "boxingpro-session.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "BoxingPro session" });
      return;
    } catch { /* user cancelled the sheet: fall through to download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "boxingpro-session.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
