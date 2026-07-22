# Labeler v0

Single-file web labeler (docs/07 §3): open `tools/labeler/index.html` in any browser — no server, no build.

**Workflow (event-verification mode, the efficient path):**
1. Ingest footage → `X.skeleton.json` (tools/ingest), then `boxingpro analyze X.skeleton.json > X.analysis.json`.
2. Load archive + analysis (+ the source video side-by-side if you kept one locally).
3. Press `e` to jump to the next detected event, watch the skeleton (wrists highlighted red), press the class key (`1`–`6` punches, `f` feint, `s/r/d` slips/rolls/ducks, `p/v` steps/pivots, `0` false-positive). `x` deletes, `space` plays, `←/→` frame-steps, `[`/`]` speed.
4. **Export labels** → `X.labels.json` — the training-set unit (source ref + class windows).

Labels are ±350 ms windows around the playhead; boundary refinement happens at training time (the classifier consumes centered windows, docs/05 §6). Smoke-tested headlessly (archive load, event seeding, keystroke labeling, canvas render) in CI-compatible Playwright.

v1 upgrades when volume demands: event-boundary dragging, double-label QA queue, Supabase-backed task assignment (docs/07 §3).
