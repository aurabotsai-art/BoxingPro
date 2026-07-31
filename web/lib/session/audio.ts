/** Session sounds, synthesized inline — no audio assets to load or cache. */

/** Short percussive blip — confirms a counted strike without looking. */
export function beep(ac: AudioContext) {
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

/** Speak a coaching cue out loud — eyes stay on the opponent, not the
 *  screen. Cancels any in-flight utterance (one cue at a time, same rule
 *  as the visual layer). No-ops where speechSynthesis is unavailable. */
export function speak(text: string) {
  if (typeof speechSynthesis === "undefined") return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch {
    /* engine quirks (no voices yet, etc.) must never break the session */
  }
}

/** Two-tone bell for round start/end. */
export function bell(ac: AudioContext) {
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
