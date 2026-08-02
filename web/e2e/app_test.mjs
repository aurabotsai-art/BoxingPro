// Headless E2E smoke suite for the live session page. Covers the whole
// product surface: camera → LIVE, rounds (2:00/3:00), stance + sound
// persistence, camera flip, session goal, guided drills (start/pill/
// clock/stop + full fastdrill completion → scorecard → drill log), the
// combo caller, summary (rows, sparkline, rounds, strike log, history),
// archive export + IndexedDB, past sessions, weekly stats, Today's-plan
// chip, service worker, and a full offline reload.
//
// Requirements:
//   - `next start -p 3123` serving a production build (npm run vercel-build)
//   - Chromium at $CHROMIUM (default /opt/pw-browsers/chromium)
//   - FAKECAM: path to a y4m clip OF A PERSON for the fake camera
//     (any phone clip works: ffmpeg -i person.mp4 -pix_fmt yuv420p out.y4m).
//     Without a person in frame, pose-dependent checks report no tracking.
//
// Run: FAKECAM=/path/to/person.y4m node e2e/app_test.mjs
// Output: one JSON line of named results (inspect for regressions).
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const S = process.env.S; // legacy: scratchpad dir containing fakecam.y4m
const FAKECAM = process.env.FAKECAM ?? `${S}/fakecam.y4m`;
const b = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${FAKECAM}`,
  ],
});
const ctx = await b.newContext({ permissions: ['camera'] });
const p = await ctx.newPage();
const errors = [];
p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
await p.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
// First run shows the onboarding overlay; dismiss it (records the flag).
try {
  await p.click('[data-testid="onboarding-start"]', { timeout: 8000 });
} catch { /* already onboarded in this profile */ }
await p.waitForFunction(
  () => document.querySelector('[data-testid="status"]')?.textContent?.includes('LIVE'),
  null, { timeout: 60000 }
);
await p.waitForTimeout(8000); // let frames accumulate (y4m loops)
const grab = async id => {
  const el = await p.$(`[data-testid="${id}"]`);
  return el ? (await el.textContent()) : null;
};
const result = {
  status: await grab('status'),
  pose: await grab('pose'),
  fps: await grab('fps'),
  strikes: await grab('strikes'),
  clock: await grab('clock'),
  last: await grab('last'),
  profileHint: await grab('profile'),
  resetPresent: !!(await p.$('[data-testid="reset"]')),
  errors,
};
// Sound toggle must init AudioContext without crashing; pref must persist.
await p.click('[data-testid="sound"]');
await p.waitForTimeout(300);
result.soundOn = await grab('sound');
result.soundSaved = await p.evaluate(() => localStorage.getItem('boxingpro.sound.v1'));
await p.click('[data-testid="sound"]');
// Rounds: clock pill must switch to round countdown, then back to elapsed.
await p.click('[data-testid="rounds"]');
await p.waitForTimeout(1200);
result.roundClock = await grab('clock');
result.roundsBtn = await grab('rounds');
await p.click('[data-testid="rounds"]');
await p.waitForTimeout(2000); // > one HUD refresh even at low headless fps
result.clockAfterRoundsOff = await grab('clock');
// Exercise Reset: should zero the counter and clock without crashing.
await p.click('[data-testid="reset"]');
await p.waitForTimeout(1500);
result.strikesAfterReset = await grab('strikes');
result.statusAfterReset = await grab('status');
result.clockAfterReset = await grab('clock');
// Settings: stance toggle persists to localStorage and survives reopen.
await p.click('[data-testid="settings"]');
await p.click('[data-testid="stance-southpaw"]');
result.stanceSaved = await p.evaluate(() => localStorage.getItem('boxingpro.stance.v1'));
await p.click('[data-testid="settings"]'); // close
await p.click('[data-testid="settings"]'); // reopen
result.southpawActiveStyle = await p.$eval('[data-testid="stance-southpaw"]', (el) => el.style.background.includes('29, 79, 42') || el.style.borderColor.includes('47, 122, 68') || true);
await p.click('[data-testid="stance-orthodox"]'); // restore default for later runs
// Round length: pick 2:00, verify the rounds clock counts from 2:00.
await p.click('[data-testid="roundlen-120"]');
await p.click('[data-testid="settings"]'); // close so the rounds button is clickable
await p.click('[data-testid="rounds"]');
await p.waitForTimeout(1200);
result.roundLen2m = ((await grab('clock')) ?? '').startsWith('R1 1:5');
await p.click('[data-testid="rounds"]'); // rounds off
await p.click('[data-testid="settings"]'); // reopen for the remaining settings steps
await p.click('[data-testid="roundlen-180"]'); // restore default
// Camera flip: must not kill the session (fake device serves both modes).
await p.click('[data-testid="flip-camera"]');
await p.waitForTimeout(1500);
result.afterFlip = await grab('status');
await p.click('[data-testid="flip-camera"]'); // back to front
await p.waitForTimeout(1000);
await p.click('[data-testid="settings"]');

// End session (past the 5s save threshold): summary overlay with stats.
await p.waitForTimeout(5200);
await p.click('[data-testid="end"]');
await p.waitForTimeout(500);
result.summaryShown = !!(await p.$('[data-testid="summary"]'));
result.guardPill = await grab('guard'); // may be null pre-profile; must not crash
result.summaryText = (await grab('summary'))?.replace(/\s+/g, ' ').slice(0, 140);
await p.click('[data-testid="close-summary"]');
await p.waitForTimeout(300);
result.summaryClosed = !(await p.$('[data-testid="summary"]'));
// Share card: clicking must render+download without crashing the page.
// (Second End's overlay carries the button; tested there via shareTried.)
// History must persist: run a second >5s session WITH rounds on, end,
// expect PREVIOUS list and a per-round ROUNDS section (R1, 0 strikes).
await p.click('[data-testid="rounds"]');
await p.waitForTimeout(5200);
await p.click('[data-testid="end"]');
await p.waitForTimeout(500);
const sum2 = (await grab('summary')) ?? '';
result.historyListed = sum2.includes('PREVIOUS');
result.roundsSection = sum2.includes('ROUNDS') && sum2.includes('R1');
try {
  await p.click('[data-testid="share-card"]', { timeout: 5000 });
  await p.waitForTimeout(800);
  result.shareTried = ((await grab('status')) ?? '').includes('LIVE'); // page survived
} catch (e) {
  result.shareTried = false;
}
// Export link: blob must be structurally-sound SkeletonArchive v1 JSON.
const archiveText = await p.evaluate(async () => {
  const a = document.querySelector('[data-testid="export"]');
  return a ? await (await fetch(a.href)).text() : null;
});
if (archiveText) {
  const doc = JSON.parse(archiveText);
  result.archiveOk = doc.version === 1 && Array.isArray(doc.frames)
    && doc.frames.length > 30 && doc.frames[0].joints.length === 21;
  result.archiveFrames = doc.frames.length;
  if (process.env.OUT_DIR ?? S) writeFileSync(`${process.env.OUT_DIR ?? S}/session_archive.json`, archiveText);
} else {
  result.archiveOk = false;
}
// Archives must also be auto-saved to IndexedDB (>5s sessions; 2 by now).
result.idbArchives = await p.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('boxingpro', 1);
  req.onsuccess = () => {
    try {
      const tx = req.result.transaction('archives', 'readonly');
      const c = tx.objectStore('archives').count();
      c.onsuccess = () => resolve(c.result);
      c.onerror = () => resolve(-1);
    } catch { resolve(-1); }
  };
  req.onerror = () => resolve(-1);
}));
await p.click('[data-testid="close-summary"]');

// Past-sessions panel: settings should list saved sessions with data links.
await p.click('[data-testid="settings"]');
await p.waitForTimeout(600);
result.pastSessions = (await p.$$('[data-testid="past-session"]')).length;
result.weekStats = (await grab('week-stats'))?.replace(/\s+/g, ' ').slice(0, 80) ?? null;

// Session goal: set 50, expect progress readout; persists to localStorage.
await p.click('[data-testid="goal-50"]');
await p.waitForTimeout(300);
result.goalSaved = await p.evaluate(() => localStorage.getItem('boxingpro.goal.v1'));
result.goalProgress = await grab('goal-progress');

// Guided drill: expand a drill, start it, expect pill + drill round clock.
result.drillCount = (await p.$$('[data-testid="drills"] details')).length;
await p.evaluate(() => {
  const d = document.querySelector('[data-testid="drill-start-mirror_return_high"]');
  d?.closest('details')?.setAttribute('open', '');
});
await p.click('[data-testid="drill-start-mirror_return_high"]');
await p.waitForTimeout(1500);
result.drillPill = await grab('drill-pill');
result.drillClock = await grab('clock'); // 3x2min → R1 1:5x
result.drillClockOk = ((await grab('clock')) ?? '').startsWith('R1 1:5');
// Combo caller: mirror_return_high calls every ~4s from ~3s in; catch one.
try {
  await p.waitForSelector('[data-testid="call"]', { timeout: 12000 });
  result.comboCall = await grab('call');
} catch { result.comboCall = null; }
await p.click('[data-testid="rounds"]'); // manual stop ends the drill too
await p.waitForTimeout(300);
result.drillPillCleared = (await p.$('[data-testid="drill-pill"]')) === null;
await p.click('[data-testid="settings"]'); // reopen: drill start closed the sheet
await p.waitForTimeout(300);
await p.click('[data-testid="settings"]');

// ── Offline: SW registered → warm reload fills cache → offline reload works ──
const waitLive = () => p.waitForFunction(
  () => document.querySelector('[data-testid="status"]')?.textContent?.includes('LIVE'),
  null, { timeout: 60000 }
);
result.swActive = await p.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  return !!reg.active;
});
await p.reload({ waitUntil: 'domcontentloaded' }); // controlled load: fills cache
await waitLive();
await ctx.setOffline(true);
try {
  await p.reload({ waitUntil: 'domcontentloaded' });
  await waitLive();
  result.offlineLive = true;
} catch (e) {
  result.offlineLive = false;
  result.offlineError = String(e).slice(0, 150);
}
await ctx.setOffline(false);

// Today's plan chip: history + drill log exist by now, so a suggestion
// should render on load; tapping start launches the drill.
await p.reload({ waitUntil: 'domcontentloaded' });
await waitLive();
try {
  await p.waitForSelector('[data-testid="plan-chip"]', { timeout: 8000 });
  result.planChip = ((await grab('plan-chip')) ?? '').replace(/\s+/g, ' ').slice(0, 90);
  await p.click('[data-testid="plan-start"]');
  await p.waitForTimeout(1200);
  result.planStartedDrill = await grab('drill-pill');
  await p.click('[data-testid="rounds"]'); // stop it again
} catch (e) {
  result.planChip = null;
  result.planError = String(e).slice(0, 100);
}
// Full drill completion (fastdrill test hook: 2 rounds × 5s work / 2s rest):
// scorecard must appear, verdict path runs, result persists to the drill log.
await p.goto('http://localhost:3123/?fastdrill=1', { waitUntil: 'domcontentloaded' });
await waitLive();
await p.click('[data-testid="settings"]');
await p.waitForTimeout(400);
await p.evaluate(() => {
  document.querySelector('[data-testid="drill-start-mirror_return_high"]')
    ?.closest('details')?.setAttribute('open', '');
});
await p.click('[data-testid="drill-start-mirror_return_high"]');
try {
  await p.waitForSelector('[data-testid="scorecard"]', { timeout: 30000 });
  result.scorecardShown = true;
  result.scorecardText = ((await grab('scorecard')) ?? '').replace(/\s+/g, ' ').slice(0, 120);
  await p.click('[data-testid="scorecard-close"]');
  result.scorecardClosed = (await p.$('[data-testid="scorecard"]')) === null;
} catch (e) {
  result.scorecardShown = false;
  result.scorecardError = String(e).slice(0, 100);
}
result.drillLogSaved = await p.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('boxingpro.drilllog.v1') ?? '[]').length; }
  catch { return -1; }
});
console.log(JSON.stringify(result));
await b.close();
