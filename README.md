# Intent-to-Action Harness

Safety harness for LLM agent execution. The model proposes, the harness decides.

## What it does

Intercepts agent actions before execution, evaluates them through a deterministic policy pipeline, tracks effects, and enforces obligations.

```
Proposal → Registry → Policy → Checks → Execute → Effects → Obligations
```

## Quick start

```bash
pip install -e .
python3 -m pytest tests/ -q
python3 -m harness.cli        # demo scenarios
```

## SDK — register actions in 10 lines

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
    fx.obligate("review", due_minutes=10, verify="poll",
                failure_mode="Not reviewed")
```

## Components

| Module | What it does |
|--------|-------------|
| `harness/types.py` | Core type definitions |
| `harness/registry.py` | Action registry with 3 MVP adapters |
| `harness/policy.py` | Deterministic policy engine |
| `harness/checks.py` | Check runner (local + external) |
| `harness/executor.py` | Action executor with effect materialization |
| `harness/store.py` | Effect store protocol + in-memory implementation |
| `harness/sqlite_store.py` | Persistent SQLite effect store |
| `harness/obligations.py` | Obligation engine (sweep, breach, escalate) |
| `harness/state.py` | Proposal lifecycle state machine |
| `harness/sdk.py` | `@action` decorator, `EffectBuilder`, hook decorators |
| `harness/intent.py` | Intent classifier (free text → action types) |
| `harness/dashboard.py` | Inspector API + CLI for querying state |
| `harness/core.py` | Pipeline orchestrator |
