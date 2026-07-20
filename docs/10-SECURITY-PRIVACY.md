# 10 — Security & Privacy Architecture

_A camera pointed at a person in their home, continuously, is the maximum-sensitivity consumer data scenario. Privacy here is not compliance theater — it is product strategy ([01](01-PRODUCT-VISION.md) §7.5) and COGS strategy ([04](04-SYSTEM-ARCHITECTURE.md) §3)._

## 1. Data classification & handling

| Class | Examples | Policy |
|---|---|---|
| C1 Raw video/audio | session recordings, HFR clips | On-device by default. Leaves device only per-session opt-in; encrypted in transit/at rest; user-set retention (7/30/∞); deletion is hard-delete + storage audit |
| C2 Derived biometrics | keypoint archives, body profile, metrics | Pseudonymous storage; sync default but user-disableable (on-device-only mode exists and is honest about its feature cost) |
| C3 Account/profile | email, goals, settings | Standard PII handling |
| C4 Content/telemetry | plans, XP, perf/product analytics | Analytics pseudonymized, separated pipeline ([08](08-DATA-MODEL.md) §5); no C1/C2 ever in analytics |

Explicitly rejected collection: face-recognition identity, age/gender inference from imagery ([03](03-FEASIBILITY.md) §2), background-scene analysis beyond floor/lighting quality, contact scraping, precise location.

## 2. Legal & regulatory posture

- **Biometric statutes (BIPA/Illinois, Texas, Washington, etc.):** skeleton/keypoint data may qualify as biometric identifiers under aggressive readings. Posture: written policy, explicit consent *before* first capture, published retention schedule, no sale/sharing of biometric data, per-state counsel review before US launch. BIPA class actions are existential for CV startups — this is a launch-blocking checklist item, not a TODO.
- **GDPR/UK/EU:** consent as lawful basis for biometric-adjacent processing (Art. 9 special category caution); DPIA completed before EU launch; data-residency via Supabase EU project if EU market pursued; full DSR support (export = sessions + archives + profile in portable JSON; erasure propagates to training snapshots per [07](07-DATA-STRATEGY-MLOPS.md) §7).
- **Minors:** boxing skews young. Age gate at signup; under-16 (region-dependent) requires guardian consent flow; minors excluded from leaderboards, flywheel contribution, and cloud video by default. COPPA posture: not directed at children; enforce gate honestly.
- **Health claims:** we are a fitness/skill product. No injury-prevention, rehab, or medical claims anywhere (marketing included); injury-risk observations use non-clinical language + disclaimers ([03](03-FEASIBILITY.md) §2). Weight-cut questions get deterministic safety-first responses ([06](06-COACHING-ENGINE.md) §6).

## 3. Consent UX

Layered, per-purpose, revocable toggles (stored append-only, versioned — [08](08-DATA-MODEL.md) consents table): cloud video analysis · flywheel contribution (keypoints only, plain-language explanation with a literal stick-figure illustration) · leaderboards/social visibility. No dark patterns: defaults are OFF for everything leaving the device except C2 sync, and the on-device-only mode is a first-class setting, not a buried concession.

## 4. Security architecture

- **Transport/at rest:** TLS everywhere; Supabase-managed encryption at rest; signed URLs (short TTL) for media; certificate pinning on the mobile client.
- **AuthZ:** Supabase Auth + RLS on every user-scoped table (deny-by-default, [08](08-DATA-MODEL.md) §3); service-role keys only in server contexts; labeling/golden buckets access-audited with named-human ACLs.
- **Mobile:** local DB encrypted (SQLCipher-class) keyed via Keychain; media files under OS file protection; no secrets in the binary (server-mediated LLM calls — the Claude key never ships in the app).
- **Server:** GPU workers stateless, scrub scratch after job; jobs signed; deep-analysis containers have no egress except storage + API endpoints they need.
- **SDLC:** dependency scanning, secret scanning in CI, least-privilege infra roles; pre-launch external pen test; vulnerability-disclosure contact from day one.
- **Abuse cases considered:** shared-device household (per-profile local auth optional), stalkerware misuse (camera never records outside an explicit user-started session; visible recording indicator always), prompt-injection via user chat into Coach Brain (structured-input contract + output schema validation already constrain this, [06](06-COACHING-ENGINE.md) §6).

## 5. Transparency features

Privacy dashboard in-app: what exists where (device vs. cloud, with sizes), every consent + history, one-tap export, one-tap erase (with real completion status). "Show me what the AI sees" mode renders the stick figure live — demystifies, builds trust, doubles as a demo feature.

## 6. Third-party & IP notes

- Famous-fighter style archetypes ([06](06-COACHING-ENGINE.md) §5): factual descriptions of public sporting styles, no names/likenesses in marketing, no endorsement implication; counsel review of the feature copy. Drop-a-name fallback: archetype labels ("Mexican pressure school") if risk assessment says so.
- Licensed content (P1 video sources, mocap packs): license registry maintained per asset ([07](07-DATA-STRATEGY-MLOPS.md) §2).
- Model licenses: verify each shipped model's license (RTMPose/MMPose Apache-2.0; verify per-checkpoint dataset-license taint) before bundling.
