# Intent-to-Action Harness

Safety harness for LLM agent execution. The model proposes, the harness decides.

## Current public snapshot

This repo contains a runnable Python harness plus a TypeScript prototype:

- `harness/` — Python pipeline for proposal interpretation, registry lookup, deterministic policy, checks, execution, effects, obligations, lifecycle state, SDK helpers, SQLite persistence, dashboard queries, and CLI demos.
- `tests/` — Python regression suite covering policy routing, lifecycle, SDK registration, intent classification, dashboard queries, scheduler behavior, and store persistence.
- `ts_prototype/` and `ts_prototype_tests/` — TypeScript prototype and Node test matrix.
- `prior_work/` — historical assumptions, decisions, MVP spec, and test matrix used while shaping the prototype.

This is an experimental local-first harness, not a production sandbox. It does not execute untrusted code, provide process isolation, or replace OS/container-level controls.

## What it does

Intercepts proposed agent actions before execution, evaluates them through a deterministic policy pipeline, tracks emitted effects, and enforces follow-up obligations.

```text
Proposal -> Registry -> Policy -> Checks -> Execute -> Effects -> Obligations
```

## Quick start

```bash
pip install -e ".[dev]"
python3 -m pytest -q
python3 -m harness.cli
```

For the TypeScript prototype:

```bash
cd ts_prototype
npm install
npm test
npm run build
```

## SDK example

```python
from harness.sdk import action, EffectBuilder

@action(
    "produce_artifact",
    blast_radius="medium",
    reversible=True,
    intent=[r"```python", r"\bdef \w+\("],
)
def produce_artifact(args, resolution, now_iso, fx: EffectBuilder):
    fx.mutate("workspace", "write", f"produced {args['kind']}")
    fx.obligate(
        "review",
        due_minutes=10,
        verify="poll",
        failure_mode="Not reviewed",
    )
```

## Components

| Module | What it does |
|--------|-------------|
| `harness/types.py` | Core type definitions |
| `harness/registry.py` | Action registry with MVP adapters |
| `harness/policy.py` | Deterministic policy engine |
| `harness/checks.py` | Check runner for local and external check specs |
| `harness/executor.py` | Action executor with effect materialization |
| `harness/store.py` | Effect store protocol and in-memory implementation |
| `harness/sqlite_store.py` | Persistent SQLite effect store |
| `harness/obligations.py` | Obligation engine for sweep, breach, and escalation |
| `harness/state.py` | Proposal lifecycle state machine |
| `harness/sdk.py` | `@action`, `EffectBuilder`, and hook decorators |
| `harness/intent.py` | Regex intent classifier from free text to action types |
| `harness/dashboard.py` | Inspector API and CLI helpers for querying state |
| `harness/core.py` | Pipeline orchestrator |

## Verification

Current local verification:

```bash
python3 -m pytest -q                    # 162 passed
python3 -m compileall -q harness tests
npm --prefix ts_prototype test
npm --prefix ts_prototype run build
python3 tools/check_public_surface.py
```
