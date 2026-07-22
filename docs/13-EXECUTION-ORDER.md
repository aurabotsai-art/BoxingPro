# 13 — Execution Order: Machine Track vs. Owner Track

_The operational sequencing doc. Two tracks run in parallel: the **E-track** (executable by the AI engineering session in this cloud environment, no human hands needed) and the **M-track** (requires the owner's hands, money, identity, or judgment). Sync points show where the tracks block each other. Updated as items complete._

**Rewritten 2026-07-20 for ADR-003 (web-first PWA on Vercel).** The pivot moved most of the old M-track (Mac, Xcode, iPhone, Apple Developer account, App Store) onto the E-track: a web app can be built, tested (Playwright + Chromium is available in this environment), and deployed from here. Your manual list is now short.

---

## 1. E-track — executable in this environment, in order

Already done (E0): planning suite docs/00–13 · Rust Metrics Core (types, filters, geometry/COM, strike detection+metrics, footwork, rhythm, fault primitives; 23 tests) · **WASM build of the core verified** · three v1 contracts · content seeds + linter · Supabase schema v1 migration · CI.

| # | Item | What it is | Needs from you |
|---|---|---|---|
| E1 | **wasm-bindgen wrapper + JS API for Metrics Core** | `core-wasm/` crate exposing the pipeline to the browser; npm-consumable package with TypeScript types | Nothing |
| E2 | **Next.js app scaffold** | App Router + TypeScript + Tailwind PWA: camera capture, pose worker (MediaPipe Tasks), skeleton overlay, session flow, IndexedDB storage — built AND smoke-tested here with Playwright | Nothing |
| E3 | **S0.1 browser pose bake-off (CI half)** | MediaPipe vs MoveNet vs ONNX-web RTMPose on Chromium against sample/synthetic footage; fps + wrist-retention tables | Real-footage half needs M2; phone-browser half needs M1 (5 min with your phone) |
| E4 | ✅ **Done: combos + guard + telegraph** | `core/src/{combos,guard,telegraph}.rs`: combo assembly with boxing notation ("1-1-2") + inter-strike cadence, guard-state sampling with honesty gates, pre-punch hand-dip telegraph detection. 28 core tests | Nothing |
| E5 | ✅ **Done: ingestion tool + analysis CLI** | `tools/ingest/ingest.py` (video/registry → pose → schema-valid SkeletonArchive; verified end-to-end on real human footage) + `boxingpro analyze` / `synth-jab` CLI (archive → events/metrics/faults via the real core; verified against synthetic ground truth). YouTube downloads run on the owner's laptop — this cloud env's proxy blocks YouTube | Nothing |
| E6 | **Data-collection kit** | Shot lists, scripted session matrix, consent drafts, filming checklist for M2 | Nothing |
| E7 | **Prioritizer + template Coach Brain** | docs/06 §3 priority algorithm + deterministic CoachOutput renderer (LLM-fallback path first) | Nothing |
| E8 | **Fault taxonomy → ~40, drills → ~60 (drafts)** | Full MVP knowledge base at `status: seed` until coach panel (M4) | Nothing to write |
| E9 | ✅ **Done: labeling tool v0** | `tools/labeler/index.html` — zero-build single-file labeler: skeleton playback, analysis-event pre-seeding, hotkey labeling, JSON export. Headless-smoke-tested with Playwright | Footage (M2) to use it on |
| E10 | **Vercel deploy of the app** | Preview + production deploys via the Vercel connector; shareable URL for you to test on your phone | M3 (authorize connector) |
| E11 | **Supabase provisioning** | Create project, apply migration, buckets, RLS verification | M3 (authorize connector + cost ok) |
| E12 | **Claude Coach Brain + prompt/eval suite** | Prompts, few-shots, echo-check validator, ~100-case eval set | M5 (API key) to run evals |
| E13 | **GPU worker skeleton → deploy** | Deep-tier job runner (dummy-pose end-to-end here) | M6 (GPU account) to deploy real models |
| E14 | **Classifier training pipeline → trained v0** | Training/eval/export code (dry on synthetic now); real training on labeled data | M2 → E9 labeling |
| E15 | **Golden-clip CI harness** | Labeled clips wired into CI regression gates | M2 |

Recommended order: E1 → E2 → E3 → E6 → E4 → E5 → E7 → E8 → E9 → (E10/E11 when M3) → E12 → E13 → E14 → E15. **E1–E9 have zero owner dependencies** — "continue" advances them.

---

## 2. M-track — your manual checklist (post-pivot)

### Now

| # | Action | Why / what it blocks | Hand back |
|---|---|---|---|
| **M1** | **Test on your own phone.** When I hand you a Vercel URL (E10): open it in your phone browser, run a session, tell me what you see (fps readout, pose quality, heat) | The phone-browser half of S0.1/S0.2 — 5-minute loops, no Mac/Xcode/anything | Screenshots + the on-screen diagnostic numbers |
| **M2** | **Film the bootstrap footage.** Using my shot kit (E6): yourself + ideally 3–10 boxing folks, scripted sessions — every punch type × stance × slow/fast × 3 angles at your phone's best fps, plus native-camera slow-mo reference clips. Tripod/prop | The dataset is the moat; blocks classifier (E14), golden CI (E15), G0 accuracy claims. **Only you can film people** | Video files (cloud-drive link, Git LFS, or into a session) |
| **M3** | **Authorize connectors + approve costs:** Vercel and Supabase in your claude.ai connector settings (several connectors in this session currently need [re]authorization on your side); approve project costs when I surface them | Blocks E10 (deploys) and E11 (backend). Free tiers likely suffice at first | "Done" + cost approvals |

### Soon (block Phase 1 / beta)

| # | Action | Why / what it blocks | Hand back |
|---|---|---|---|
| **M4** | **Recruit 2–3 credentialed boxing coaches** (advisor fee/equity; I draft the outreach + review packet) | O1. Blocks taxonomy `panel_reviewed` status and G1 coaching-correctness | Names + agreements; their markup of content/ |
| **M5** | **Claude API account/key** (console.anthropic.com) + monthly AI budget | Blocks live Coach Brain + evals (E12) | Key via env config (never in chat/repo) |
| **M6** | **GPU worker account** (Modal-class; free tier fine) | Blocks deep-tier deploy (E13) | Account/auth config |
| **M7** | **Privacy/biometrics lawyer, one consult** (BIPA/GDPR posture, consent copy) | O2. Blocks public beta — existential risk class (docs/10 §2) | Counsel's checklist deltas |
| **M8** | **Product identity decisions:** confirm "BoxingPro" name (trademark search), domain purchase, launch market, pricing intent | Blocks domain/branding, legal scope, Stripe setup | Decisions + domain |

### Later (block launch, not development)

| # | Action | Why |
|---|---|---|
| **M9** | **Recruit ~50 beta testers** (gym relationships from M2 are the seed; I draft the pitch) | G1 activation/retention needs humans |
| **M10** | **Stripe account** (needs a legal entity → M11) | Subscriptions at Phase-2 launch |
| **M11** | **Business formation** (LLC/company, bank) when money starts moving | Can't charge without it |
| **M12** | **Phone test pool** — a low-end Android and an older iPhone (borrowed is fine) for the browser matrix | G3 cross-browser parity |
| **M13** | **Slow-mo ground-truth clips** (any recent phone's native 240fps camera) | Power-index validation study (Phase 2) |

**Gone from the list (pivot dividend):** Mac + Xcode, Apple Developer account, App Store review, TestFlight, iOS device matrix purchases.

### Standing (recurring involvement)

- **Weekly:** "continue" the E-track; answer parked questions; test the latest deploy on your phone (M1 loop).
- **After M4:** route monthly content/coach-output reviews to the panel.
- **Every gate (G0–G3):** you sign off. Gates are yours.

---

## 3. Sync points (post-pivot)

```
E1–E9 ────────────────┐  (no owner dependencies — running now)
                      │
M3 (connectors) ──────┼─→ E10 deploy + E11 backend → SYNC-1: URL on your phone (M1)
M2 (footage) ─────────┼─→ E9 label → E14 train → E15 golden CI
                      │
   SYNC-1 (browser bake-off on real phones)
        + M2 pipeline ═══→ GATE G0 (viability — owner sign-off)
                      │
M4 (coaches) ─────────┼─→ taxonomy blessed → Phase 1 coaching quality
M5 (API key) ─────────┼─→ E12 Coach Brain live
M6 (GPU acct) ────────┼─→ E13 deep tier live
M7 (lawyer) ──────────┴─→ public beta unblocked (with M9)
```

**The critical path is now M2 (footage) + M3 (connectors).** M3 is ten minutes of clicking; M2 is the one genuinely irreplaceable human job left. Everything else — building, testing, deploying the entire product — runs on the E-track.
