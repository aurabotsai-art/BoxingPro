# Coach Brain eval set

Frozen eval cases (docs/07 §6): each case = analysis payload + assertions.
Runs on every prompt/model change once the API key exists (M5); the template
renderer is evaluated against the same cases today. Target ~100 cases;
seeded with the archetypes below. Add cases, never mutate existing ones.

Assertions per case: schema-valid; echo-check passes (every number in text
exists in payload); required block sequence; banned-content checks
(medical/weight-cut); fault/drill ids exist in content/.

Run: `python3 coach_brain/eval/run_eval.py` (template path today).
