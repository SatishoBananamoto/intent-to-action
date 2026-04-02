# Intent-to-Action Harness — Tracking Doc

## Quick Start

```bash
# Full Python suite (324 tests)
cd ~/relay/workspace
python3 -m pytest tests/ -q

# TypeScript prototype (27 tests)
cd ~/relay/workspace/intent-to-action
node --experimental-strip-types --test tests/harness.test.ts

# CLI demo
python3 -m harness.cli
```

## Status: M2 Complete, M3 Relay Integration Complete

Python: 380 tests passing. TypeScript: 27 tests passing, tsc clean.

---

## NEXT SESSION — START HERE

**M1–M4 complete.** The intent-to-action harness is fully built and integrated into the relay discussion tool.

**What exists (380 Python tests, 27 TypeScript tests, all green):**
- `harness/` — Core pipeline: Interpreter → Registry → Policy → Checks → Executor → Effects → Obligations
- `harness/sdk.py` — `@action` decorator, `EffectBuilder`, hook decorators (precondition, approval_gate, conflict_check, intent, extract_args)
- `harness/intent.py` — `IntentClassifier` routes free text → action types via SDK-registered patterns
- `harness/sqlite_store.py` — Persistent effect store
- `relay_discussion/harness_adapter.py` — 5 relay adapters via SDK: `produce_artifact`, `request_permission`, `fix_issue`, `analyze`, `escalate`
- `RelayConfig(use_harness=True)` — proper config flag, no monkey-patching
- Behavioral rules + harness evaluate together, most restrictive wins

**M5 candidates:**
1. LLM-backed classifier — fallback when regex patterns miss
2. Obligation dashboard — query/visualize open and breached obligations
3. Adapter hot-reload — register new actions without restart

---

## Architecture

```
Proposal + Resolution
  → Registry lookup (deny unregistered)
  → Policy evaluate (fields → resolution → effects → preconditions → decision)
  → Checks (if decision = "check" or "approve")
  → Execute (if allowed)
  → Effect Store (append mutations + commitments + obligations)
  → Obligation Engine (sweep → breach → escalate)
  → Lifecycle callback (obligation status → proposal state)
```

## Milestones

### Milestone 1 — Thin Vertical Slice ✅
- [x] Type definitions
- [x] Action Registry + 3 adapters (SendQuoteEmail, DeleteRows, ScheduleMeeting)
- [x] Deterministic Policy Engine
- [x] In-memory Effect Store with intersection queries
- [x] Executor with effect materialization
- [x] Obligation Engine with sweep/breach/escalation
- [x] Pipeline orchestrator (Harness class)
- [x] Test matrix T1-T20 + regression checks
- [x] CLI demo
- [x] Codex review + fixes

### Milestone 2 — Persistence + Structural Fixes ✅
- [x] SQLite effect store (`sqlite_store.py`, tested end-to-end)
- [x] Adapter-owned conflict detection (`conflict_detector` on ActionSpec)
- [x] Multi-entity selector resolution (SelectorSpec cardinality, entity_slots)
- [x] Lifecycle completion (obligation → proposal state via callback)
- [x] Store backend injection (EffectStore protocol)
- [x] Approval workflow (`create_approval_request()`, `approve()`, `reject()`)
- [x] CheckSpec execution mode (`CheckMode.LOCAL` vs `CheckMode.EXTERNAL`)
- [x] Proposal revisioning (`revise()` with `supersedes` lineage, `SUPERSEDED` state)

### Milestone 3 — Relay Integration ✅
- [x] Relay-harness adapter (`harness_adapter.py`)
- [x] Three action adapters: `produce_artifact`, `request_permission`, `fix_issue`
- [x] Integrated policy: behavioral rules + harness, most restrictive wins
- [x] 13 adapter tests + 122 relay tests passing
- [x] Backward compatible: `use_harness=False` default preserves existing behavior

### Milestone 4 — SDK + Intent + Integration ✅
- [x] Adapter authoring SDK (`harness/sdk.py`)
- [x] Relay adapters rewritten with SDK (98 → 35 lines)
- [x] End-to-end relay session tests with harness (10 tests)
- [x] Intent classification system (`harness/intent.py`, 24 tests)
- [x] SDK intent patterns + arg extractors (`@action(intent=[...])`, `@handle.extract_args`)
- [x] Relay adapter wired to IntentClassifier
- [x] `analyze` + `escalate` relay adapters added via SDK
- [x] `use_harness` flag on `RelayConfig` (proper integration, no monkey-patching)

### Milestone 5 — Future
- [ ] LLM-backed classifier (IntentClassifier fallback when patterns miss)
- [ ] Adapter hot-reload (register new actions without restart)
- [ ] Obligation dashboard (query open/breached obligations)

## Session Log

### 2026-04-02 — Session 1: Initial Build
- Built all Milestone 1 components from prior work spec
- 24/24 TS tests passing, 87 Python tests passing
- CLI demo exercises full pipeline
- Submitted to Codex for review

### 2026-04-02 — Session 2: Codex Review + Fixes
- Codex found 4 bugs: now_iso clock propagation, incomplete commitment payload, missing table in mutation summary, string-based time comparison
- Fixed all 4, expanded tests to 59+28 passing
- Codex identified two structural risks: multi-entity resolution and lifecycle completion

### 2026-04-02 — Session 3: Structural Fixes
- Implemented multi-entity selector contract (SelectorSpec, cardinality, entity_slots)
- Implemented lifecycle completion (source_proposal_id, on_status_change callback, aggregate logic)
- Implemented store backend injection (EffectStore protocol, SqliteEffectStore)
- Implemented adapter-owned conflict detection
- 129 tests passing across all harness suites

### 2026-04-02 — Session 4: Codex Review Design Debt
- Added CheckSpec execution mode: `CheckMode.LOCAL` vs `CheckMode.EXTERNAL` — external checks fail with `awaiting_check_evidence` instead of `no_implementation_registered`
- Added proposal revisioning: `Harness.revise()` creates new proposal with `supersedes` lineage, old lifecycle transitions to `SUPERSEDED` (terminal). Removed unsafe CLARIFY → PROPOSED transition.
- Added approval workflow: `create_approval_request()` extracts structured risk info, `approve()` gates on checks, `reject()` denies with reason. Replaces raw `approved=True` pattern.
- Python: 141 tests passing (12 new tests for the three features)

### 2026-04-02 — Session 4b: TS Prototype Bug Fixes
Fixed all 4 Codex review findings in the TypeScript prototype:
1. **High: approve bypassed checks.** `process()` now runs required checks for `approve` decisions and blocks execution if any fail. Added regression test.
2. **High: tsc build failed.** Added `allowImportingTsExtensions` + `noEmit` to tsconfig. Fixed `EffectTemplate` return type — was `Omit<Effect, ...>` including `entityIds` etc that adapters don't return, now explicit `{ mutations, commitments, obligations }`.
3. **Medium: DeleteRows no safe path.** Added `requiresApproval` to `ActionSpec`. DeleteRows now checks for `backupRef` — with backup → CHECK path, without → APPROVE. `sql_dry_run` now `requiredFor: ["allow", "approve"]`.
4. **Medium: no interpreter.** Added `interpreter.ts` with full selector cardinality support (one/many), per-item ambiguity, slot-level resolution. Mirrors Python interpreter.
- TypeScript: 27 tests passing, `tsc --noEmit` clean

### 2026-04-02 — Session 5: Relay Integration (M3)
Wired harness into relay discussion tool as its structural safety layer:
- Built `relay_discussion/harness_adapter.py` — `HarnessAdapter` bridges relay turns to harness pipeline
- Registered 3 action adapters: `produce_artifact` (medium blast, reversible), `request_permission` (high blast, always approve), `fix_issue` (medium blast, reversible)
- Action classification via regex: maps relay turn content to action types, unregistered types bypass harness
- Integrated into `RelayPolicyHarness`: `use_harness=True` runs both behavioral rules and harness, most restrictive decision wins
- Fixed pre-existing stale assertion in `test_relay_forces_change_after_repeated_permission_requests` (OutputDeltaRule fires before RepeatedFailureRule)
- 324 Python tests passing (141 harness + 13 adapter + 66 engine + 56 relay non-engine + 48 other)

### 2026-04-02 — Session 6: Adapter Authoring SDK (M4)
Built `harness/sdk.py` — declarative adapter registration:
- `@action` decorator: creates ActionSpec, wraps function body into EffectTemplate, auto-registers into target registry
- `EffectBuilder` context: `.mutate()`, `.commit()`, `.obligate()` replace raw list construction
- Hook decorators: `@handle.precondition`, `@handle.approval_gate`, `@handle.conflict_check`
- Sensible defaults: version="1", feedback_latency inferred from blast_radius, required_args=[]
- String-based enums: `blast_radius="medium"` instead of `BlastRadius.MEDIUM`
- Rewrote all 3 relay adapters with SDK: 98 lines → 35 lines, identical behavior
- 346 Python tests passing (22 new SDK tests)

### 2026-04-02 — Session 6c: Closing M4
- Added `analyze` + `escalate` relay adapters via SDK (analyze: low blast, tracks analysis effects; escalate: high blast, always approve, creates human_response obligation)
- Added `use_harness: bool = False` to `RelayConfig` — proper config flag replaces monkey-patching in tests
- Updated engine.py to pass `config.use_harness` to `RelayPolicyHarness`
- Added 3 e2e tests: analysis tracking, escalation pause, config flag verification
- Fixed intent test: `analyze` now registered with patterns, updated expectation
- 380 Python tests passing, M4 milestone closed

### 2026-04-02 — Session 6b: Intent Classification + E2E
- Built `harness/intent.py` — `IntentClassifier` routes free text to action types via SDK-registered intent patterns
- Priority ordering: high blast radius patterns checked first (catches dangerous actions before benign ones)
- `classify_all()` returns all matching intents when text contains multiple
- Added `@action(intent=[...])` kwarg and `@handle.intent()` / `@handle.extract_args` decorators to SDK
- Wired relay adapter to use `IntentClassifier` instead of `classify_relay_action` in harness path
- `produce_artifact` gets automatic `_artifact_kind` extraction via `@produce_artifact.extract_args`
- Built 7 end-to-end tests proving relay engine + harness pipeline + effects + obligations work together
- 376 Python tests passing (23 new intent + 7 new e2e)

## Work Items

| ID | Item | Status | Milestone |
|----|------|--------|-----------|
| W1 | Core types | Done | M1 |
| W2 | Effect Store (in-memory) | Done | M1 |
| W3 | Action Registry + adapters | Done | M1 |
| W4 | Policy Engine | Done | M1 |
| W5 | Executor | Done | M1 |
| W6 | Obligation Engine | Done | M1 |
| W7 | Harness pipeline | Done | M1 |
| W8 | Test matrix | Done | M1 |
| W9 | CLI demo | Done | M1 |
| W10 | Codex review | Done | M1 |
| W11 | SQLite store | Done | M2 |
| W12 | Approval workflow UX | Pending | M2 |
| W13 | Adapter-owned conflict detection | Done | M2 |
| W14 | TS prototype bugs (4 from Codex review) | Done | M2 |
| W15 | CheckSpec execution mode | Done | M2 |
| W16 | Proposal revisioning | Done | M2 |
| W17 | Approval workflow | Done | M2 |
| W18 | Relay-harness adapter | Done | M3 |
| W19 | Relay action adapters (3) | Done | M3 |
| W20 | Integrated policy (most restrictive wins) | Done | M3 |
| W21 | Adapter + relay test suite (135 tests) | Done | M3 |
| W22 | Adapter authoring SDK | Done | M4 |
| W23 | Relay adapters rewritten with SDK | Done | M4 |
| W24 | End-to-end relay+harness tests | Done | M4 |
| W25 | Intent classification system | Done | M4 |
| W26 | SDK intent patterns + arg extractors | Done | M4 |
| W27 | analyze + escalate relay adapters | Done | M4 |
| W28 | use_harness on RelayConfig | Done | M4 |
