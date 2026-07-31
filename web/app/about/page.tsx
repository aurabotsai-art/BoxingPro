import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — BoxingPro",
  description: "How BoxingPro works, and the privacy promise: your video never leaves your phone.",
};

const h = { fontSize: 13, letterSpacing: 2, color: "#ff4d4d", fontWeight: 700 as const, margin: "28px 0 8px" };
const p = { fontSize: 15, lineHeight: 1.65, color: "#c6ccd6", margin: "0 0 12px" };

export default function AboutPage() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 20px 80px" }}>
      <a href="/" style={{ color: "#61dafb", textDecoration: "none", fontSize: 14, fontWeight: 700 }}>
        ← back to training
      </a>
      <h1 style={{ fontSize: 34, fontWeight: 900, margin: "18px 0 4px" }}>
        <span style={{ color: "#ff4d4d" }}>Boxing</span>Pro
      </h1>
      <div style={{ color: "#9aa0aa", fontSize: 15 }}>An AI boxing coach that needs nothing but your phone camera.</div>

      <div style={h}>WHAT IT DOES</div>
      <p style={p}>
        Point your phone at yourself and train. BoxingPro tracks your body in real time and measures what a coach
        watches: hand speed in meters per second, guard position and how fast your hands return after every punch,
        punch types (jab, cross, hook, uppercut), combinations in boxing notation, footwork, and rhythm. It coaches
        out loud between exchanges, calls drills the way a trainer calls pads, grades each drill against a written
        success standard, and tracks your mastery streaks session to session.
      </p>

      <div style={h}>YOUR VIDEO NEVER LEAVES YOUR PHONE</div>
      <p style={p}>
        All analysis runs on your device, in your browser. The camera feed is processed frame by frame into 21 body
        keypoints — dots and coordinates, not images — and the video itself is never uploaded, never stored, never
        seen by anyone. What the app keeps (your session stats and, if you want, the keypoint data for film study)
        stays on your device unless you export it yourself.
      </p>

      <div style={h}>HONEST NUMBERS ONLY</div>
      <p style={p}>
        Every number is computed by deterministic measurement code — never guessed, never generated. When something
        can&apos;t be measured reliably (bad lighting, low frame rate, too few samples), BoxingPro says so or stays
        silent instead of showing pseudo-precision. Grades exist only where a drill has a written, measurable
        standard.
      </p>

      <div style={h}>WORKS OFFLINE</div>
      <p style={p}>
        Install it to your home screen and the whole gym experience — camera analysis, drills, voice coaching,
        history — works with no connection at all.
      </p>

      <div style={{ marginTop: 36, borderTop: "1px solid #262a33", paddingTop: 16, fontSize: 12, color: "#565c66" }}>
        BoxingPro is a training tool, not medical advice. Train within your limits.
      </div>
    </main>
  );
}
