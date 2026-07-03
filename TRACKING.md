# Intent-to-Action Harness — Tracking Doc

## NEXT SESSION — START HERE

Current public status:

- Repo is a standalone safety-harness prototype, not the full relay discussion integration.
- Python harness is runnable from this repo and currently has 162 passing tests.
- TypeScript prototype is runnable from `ts_prototype/` and tested by `ts_prototype_tests/`.
- Public metadata now includes an MIT `LICENSE` file matching `pyproject.toml`.
- CI should run Python tests, Python compile checks, TypeScript tests, TypeScript build, and the public-surface guard.

Recommended next work:

1. Add a small end-to-end example that starts from free text, classifies intent, runs policy, and shows the final lifecycle/effect/obligation records.
2. Decide whether the TypeScript prototype should stay as a historical comparison or be promoted into a first-class package layout.
3. Revisit the LLM-backed classifier idea only after the deterministic harness boundaries are documented and regression-tested.

## Verified Commands

Run from the repository root unless noted:

```bash
python3 -m pytest -q
python3 -m compileall -q harness tests
python3 -m harness.cli
node --experimental-strip-types --test ts_prototype_tests/harness.test.ts
python3 tools/check_public_surface.py

cd ts_prototype
npm install
npm test
npm run build
```

## Architecture

```text
Proposal + Resolution
  -> Registry lookup: deny unregistered action types
  -> Policy evaluation: fields, resolution, effects, preconditions, decision
  -> Checks: local or external evidence gates when required
  -> Execution: only after allow/check-pass/approved-check-pass
  -> Effect store: append mutations, commitments, obligations
  -> Obligation engine: sweep, breach, escalate
  -> Lifecycle tracker: proposal state transitions and audit trail
```

## What Exists

- `harness/core.py` — orchestrates interpret, policy, checks, execute, effects, obligations, and lifecycle state.
- `harness/sdk.py` — adapter authoring SDK with `@action`, `EffectBuilder`, preconditions, approval gates, conflict checks, intent patterns, and arg extractors.
- `harness/intent.py` — deterministic regex-based intent classifier.
- `harness/sqlite_store.py` — persistent effect store.
- `harness/dashboard.py` — query/inspection API for effects, commitments, obligations, and proposal lifecycle.
- `tests/` — Python regression coverage for the current harness.
- `ts_prototype/` — TypeScript version of the prototype.
- `ts_prototype_tests/` — TypeScript test matrix.
- `prior_work/` — historical design notes and earlier spec artifacts.

## Known Boundaries

- The harness does not sandbox processes or isolate untrusted code execution.
- The intent classifier is deterministic regex matching, not semantic model classification.
- External check specs are represented structurally; live third-party check execution is not wired here.
- Relay integration was explored elsewhere; this public repo does not contain `relay_discussion/` source files.

## Future Candidates

- LLM-backed classifier fallback when deterministic patterns miss.
- Adapter hot-reload for registering actions without restart.
- Obligation dashboard UI for open and breached obligations.
- Production-grade execution isolation boundary around any real side-effecting adapter.
