# 13 — Execution Order: Machine Track vs. Owner Track

_The operational sequencing doc. Two tracks run in parallel: the **E-track** (executable by the AI engineering session in this cloud environment, no human hands needed) and the **M-track** (requires the owner's hands, money, identity, or judgment). Sync points show where the tracks block each other. Updated as items complete._

**How to use this doc:** the E-track advances whenever you say "continue." The M-track is your personal checklist — every item lists *why it's needed, what it blocks, and what to hand back*. Nothing on the E-track ever waits silently: when an E-item hits an M-dependency, it's parked and named here.

---

## 1. E-track — executable in this environment, in order

Already done (E0): planning suite docs/00–12 · Rust Metrics Core (types, filters, geometry/COM, strike detection+metrics, footwork, rhythm, fault primitives; 23 tests) · three v1 contracts · content seeds (4 faults, 8 drills) + linter · Supabase schema v1 migration file · CI (fmt, clippy, tests, content lint, schema validation).

| # | Item | What it is | Needs from you |
|---|---|---|---|
| E1 | **Combo assembler + guard-state sampler + telegraph primitives** | Remaining pure-math pipeline pieces: strike sequences → "1-1-2" combination strings; continuous guard-position classification; pre-punch tell detection windows | Nothing |
| E2 | **SkeletonArchive JSON I/O + analysis runner** | Reader/writer for the archive contract + a CLI that runs archive → SessionAnalysis JSON through the full core. This is the harness your first real footage drops into | Nothing |
| E3 | **Fault taxonomy → ~40, drills → ~60 (draft status)** | Full MVP coaching knowledge base, marked `status: seed` until coach panel review (M4) upgrades entries to `panel_reviewed` | Nothing to write; M4 to bless |
| E4 | **Prioritizer + template Coach Brain** | The docs/06 §3 priority algorithm in code, plus the deterministic CoachOutput template renderer (the LLM-unavailable fallback path — building it first forces clean structure) | Nothing |
| E5 | **Claude Coach Brain + prompt/eval suite** | Prompt templates, few-shots, echo-check validator, the ~100-case LLM eval set from docs/07 §6 | M8 (API key/billing) to actually run evals |
| E6 | **Labeling tool v0** | Local web app: video + skeleton overlay, scrub, event marking, class hotkeys (docs/07 §3) | Nothing to build; footage (M2) to use |
| E7 | **Data-collection kit** | Shot lists, scripted session matrix, consent forms draft, filming checklist for your capture days (M2) | Nothing |
| E8 | **iOS app scaffold (written blind)** | Swift/SwiftUI project: capture pipeline, setup assistant, session flow, Metrics Core FFI bindings — written here, **cannot be compiled or run here** (no Xcode/macOS). Sits ready for M1 | M1 to build/verify |
| E9 | **GPU worker skeleton** | Python job runner: poll jobs table → decode → pose (server models) → core metrics → write analysis. Runs end-to-end on CPU with dummy pose here; real models need M9 | M9 (GPU account) to deploy |
| E10 | **Supabase provisioning** | Create project, apply migration 00001, storage buckets, RLS verification — I can do this directly through the Supabase connector | M6 (authorize connector + confirm cost) |
| E11 | **Classifier training pipeline (dry)** | PyTorch training/eval/export code for the ST-GCN-class model, validated on synthetic sequences; real training needs the labeled dataset | M2 (footage) → E6 labeling |
| E12 | **Golden-clip CI harness** | Wire real labeled clips (once they exist) into CI regression gates per docs/04 §8 | M2 |

Recommended E-order: E1 → E2 → E7 → E4 → E3 → E6 → E5 → E8 → E9 → E11 → (E10, E12 when unblocked). E1–E7 have zero external dependencies — say "continue" and they proceed.

---

## 2. M-track — your manual checklist

### Now (unblocks the most)

| # | Action | Why / what it blocks | Hand back |
|---|---|---|---|
| **M1** | **Get the iOS toolchain in your hands:** a Mac with Xcode, an iPhone (any recent model; ideally also an older one), and an Apple Developer account ($99/yr) | ALL device spikes (S0.1 pose bake-off, S0.2 fps tests) and every iOS build forever. This environment has no macOS/devices — I write the code, **you build and run it** and paste results/screenshots back | Xcode build results, benchmark numbers, crash logs |
| **M2** | **Film the bootstrap footage.** Using my shot lists (E7): yourself + ideally 3–10 boxing folks (a local gym helps), scripted sessions — every punch type × stance × slow/fast × 3 angles, 60fps, plus 240fps slow-mo reference clips. Phone on a tripod/prop | Spikes S0.3–S0.5, the classifier (E11), golden clips (E12) — **the dataset is the moat and only you can film it** | Video files (upload to the repo via Git LFS, a cloud drive link, or directly into a session) |
| **M3** | **Confirm your role & resources.** Are you solo? Budget envelope? Timeline pressure? | Calibrates how aggressively I sequence everything (e.g. whether E8 iOS scaffold is worth writing blind now or after M1) | A short message |

### Soon (blocks Phase 1 / beta)

| # | Action | Why / what it blocks | Hand back |
|---|---|---|---|
| **M4** | **Recruit 2–3 credentialed boxing coaches** (advisor fee or equity). I'll draft the outreach message and the review packet | Red-team item O1. Fault taxonomy and drill library can't be *blessed* by engineers; blocks "panel_reviewed" status and gate G1 coaching-correctness | Names + agreement; then their markup of content/ |
| **M5** | **Engage a privacy/biometrics lawyer** (one consult to start: BIPA/GDPR posture, consent copy review) | Red-team item O2. Blocks public beta — biometric class actions are existential (docs/10 §2) | Counsel's checklist deltas |
| **M6** | **Authorize the infrastructure connectors** in your claude.ai settings (Supabase; Vercel if we host anything web) and approve project costs when I surface them | Blocks E10. Note: some connected services in this session currently need (re)authorization on your side before I can drive them | A "done" + cost approvals |
| **M7** | **Decide product identity basics:** confirm the name "BoxingPro" (quick trademark search — a lawyer or even a USPTO/EUIPO web search), pick initial markets (US-only first?), pricing intent | Blocks App Store metadata, marketing copy, and the legal review scope | Decisions in a message |
| **M8** | **Set up the Claude API account/key** (console.anthropic.com) and decide monthly AI budget | Blocks running the Coach Brain evals (E5) and any live coaching narrative | Key via secure env config (never paste into chat/repo) |
| **M9** | **Create the GPU worker account** (Modal or similar; free tiers exist) | Blocks deploying E9 deep-analysis tier | Account + auth config |

### Later (blocks launch, not development)

| # | Action | Why / what it blocks |
|---|---|---|
| **M10** | **Apple App Store setup:** app record, TestFlight, review compliance (camera/privacy strings), screenshots | Public beta and launch |
| **M11** | **Recruit ~50 beta testers** (the M2 gym relationships are the seed; I'll draft the recruitment post) | Gate G1 activation/retention numbers need real humans |
| **M12** | **Device test matrix purchase** (red-team O3): floor-spec iPhone + current base + Pro; Androids in Phase 3 | Release benchmark gates |
| **M13** | **240fps ground-truth rig** (any recent iPhone's slow-mo counts) for the power-index validation study | Phase 2 honesty artifact |
| **M14** | **Business formation** (LLC/company, bank, insurance) when money starts moving | Subscriptions can't ship without an entity |

### Standing (recurring involvement)

- **Weekly:** answer parked questions; "continue" the E-track; review anything I flag as a judgment call.
- **After M1:** run device builds/benchmarks when I hand you a build — this becomes the core loop of Phase 0/1 (I code → you run on device → paste results → I iterate).
- **After M4:** route monthly content/coach-output reviews to the panel.
- **Every gate (G0–G3):** you are the sign-off. Gates are yours, not mine.

---

## 3. Sync points (where the tracks meet)

```
E1–E7 ──────────────┐  (no dependencies — running now)
                    │
M1 (Mac+iPhone) ────┼─→ SYNC-1: S0.1/S0.2 pose & fps bake-off on device
M2 (footage) ───────┼─→ SYNC-2: label (E6) → train (E11) → S0.3–S0.5 → golden CI (E12)
                    │
        SYNC-1 + SYNC-2 ═══→ GATE G0 (product viability — owner sign-off)
                    │
M4 (coaches) ───────┼─→ taxonomy blessed → Phase 1 coaching quality
M6 (connectors) ────┼─→ E10 backend live
M8 (API key) ───────┼─→ E5 Coach Brain evals live
M5 (lawyer) ────────┴─→ public beta unblocked (with M10, M11)
```

**The critical path is M1 + M2.** Every week without a device and footage, the E-track builds further ahead on synthetic data — useful, but G0 (the "is this product physically viable" gate) cannot close without them. If you do only two things this month, do those two.
