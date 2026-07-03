import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Harness } from "../ts_prototype/harness.ts";
import { ActionRegistry } from "../ts_prototype/registry.ts";
import { resetActionCounter } from "../ts_prototype/executor.ts";
import type { Proposal, Resolution } from "../ts_prototype/types.ts";

// --- Test helpers ---

function makeProposal(overrides: Partial<Proposal> & { actionType: string }): Proposal {
  return {
    proposalId: `test:${overrides.actionType}:${Date.now()}`,
    args: {},
    evidenceRefs: [],
    blockers: [],
    ...overrides,
  };
}

function cleanResolution(overrides?: Partial<Resolution>): Resolution {
  return {
    entityIds: ["client:123"],
    resourceKeys: ["product:abc"],
    semanticKeys: ["quote"],
    conflicts: [],
    entitySlots: {},
    resourceSlots: {},
    ...overrides,
  };
}

const NOW = "2026-04-02T12:00:00.000Z";
const FUTURE = "2026-05-01T00:00:00.000Z";
const PAST = "2026-03-01T00:00:00.000Z";

// ============================================================
// Test Matrix (T1-T20)
// ============================================================

describe("SendQuoteEmail", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = new Harness();
    resetActionCounter();
  });

  // T1: Missing validUntil → clarify with missing_required_arg
  it("T1: clarify when validUntil is missing", () => {
    const proposal = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        // validUntil missing
        termsVersion: "v2",
      },
    });

    const result = harness.evaluate(proposal, cleanResolution(), NOW);
    assert.equal(result.policyDecision.decision, "clarify");
    assert.ok(result.policyDecision.blockers.includes("missing_required_arg"));
    assert.ok(result.policyDecision.reasonCodes.some((r) => r.includes("validUntil")));
  });

  // T2: Client with two matches → clarify with entity_resolution_conflict
  it("T2: clarify on entity resolution conflict", () => {
    const proposal = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        validUntil: FUTURE,
        termsVersion: "v2",
      },
    });

    const resolution = cleanResolution({
      conflicts: ["client:123 matches client:456"],
    });

    const result = harness.evaluate(proposal, resolution, NOW);
    assert.equal(result.policyDecision.decision, "clarify");
    assert.ok(result.policyDecision.blockers.includes("entity_resolution_conflict"));
  });

  // T3: Conflicting open commitment → deny with commitment_conflict
  it("T3: deny on commitment conflict", () => {
    // First: send a quote successfully
    const firstProposal = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        validUntil: FUTURE,
        termsVersion: "v2",
      },
    });
    const res = cleanResolution();
    harness.process(firstProposal, res, { now: NOW });

    // Second: different price for same client/product → conflict
    const conflicting = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 200, // different price
        currency: "USD",
        validUntil: FUTURE,
        termsVersion: "v2",
      },
    });

    const result = harness.evaluate(conflicting, res, NOW);
    assert.equal(result.policyDecision.decision, "deny");
    assert.ok(result.policyDecision.blockers.includes("commitment_conflict"));
  });

  // T4: All fields present, price source stale → check
  it("T4: check when cheap checks are required", () => {
    // Override pricing check to fail
    harness.registry.registerCheck("pricing_source_lookup", () => ({
      checkId: "pricing_source_lookup",
      passed: false,
      detail: "Price source is stale (last updated 48h ago)",
    }));

    const proposal = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        validUntil: FUTURE,
        termsVersion: "v2",
      },
    });

    const result = harness.process(proposal, cleanResolution(), { now: NOW });
    assert.equal(result.evaluation.policyDecision.decision, "check");
    assert.ok(result.evaluation.checkResults.some((r) => !r.passed));
    // Should NOT execute when check fails
    assert.equal(result.execution, undefined);
  });

  // T5: Successful quote → allow, persist commitment and obligation
  it("T5: allow and persist effects on success", () => {
    const proposal = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        validUntil: FUTURE,
        termsVersion: "v2",
      },
    });

    const result = harness.process(proposal, cleanResolution(), { now: NOW });
    // Policy returns "check" because there's a cheap check, but default check passes
    assert.notEqual(result.execution, undefined);
    assert.equal(result.execution!.status, "executed");

    const effect = result.execution!.effect!;
    assert.equal(effect.commitments.length, 1);
    assert.equal(effect.commitments[0].kind, "quote");
    assert.equal(effect.obligations.length, 1);
    assert.equal(effect.obligations[0].kind, "quote_acknowledgement");
    assert.equal(effect.obligations[0].status, "open");
  });

  // T6: No reply by deadline → obligation breached
  it("T6: obligation breached when deadline passes", () => {
    const proposal = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        validUntil: NOW, // expires at NOW
        termsVersion: "v2",
      },
    });

    harness.process(proposal, cleanResolution(), { now: PAST });

    // Sweep after the deadline
    const events = harness.sweepObligations(FUTURE);
    assert.ok(events.some((e) => e.kind === "breached"));
    assert.ok(events.some((e) => e.kind === "escalation"));
  });
});

describe("DeleteRows", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = new Harness();
    resetActionCounter();
  });

  // T7: Empty predicate → deny
  it("T7: deny on empty predicate", () => {
    const proposal = makeProposal({
      actionType: "DeleteRows",
      args: {
        connectionId: "db:main",
        table: "users",
        predicate: "",
        dryRunCount: 0,
      },
    });

    const result = harness.evaluate(proposal, cleanResolution(), NOW);
    assert.equal(result.policyDecision.decision, "deny");
    assert.ok(result.policyDecision.blockers.includes("blast_radius_exceeds_limit"));
  });

  // T8: Large dryRunCount, no backup → approve (high risk irreversible)
  it("T8: approve on high-risk irreversible delete", () => {
    const proposal = makeProposal({
      actionType: "DeleteRows",
      args: {
        connectionId: "db:main",
        table: "users",
        predicate: "status = 'inactive'",
        dryRunCount: 50000,
      },
    });

    const result = harness.evaluate(proposal, cleanResolution(), NOW);
    assert.equal(result.policyDecision.decision, "approve");
    assert.ok(result.policyDecision.reasonCodes.includes("high_risk_irreversible"));
  });

  // T9: Safe predicate with backup → check path (not approve)
  it("T9: backup allows cheaper check path", () => {
    const proposal = makeProposal({
      actionType: "DeleteRows",
      args: {
        connectionId: "db:main",
        table: "users",
        predicate: "id = 42",
        dryRunCount: 1,
        backupRef: "backup:2026-04-02",
      },
    });

    const result = harness.process(proposal, cleanResolution(), { now: NOW });
    // With backup, requiresApproval returns false → falls through to check
    assert.equal(result.evaluation.policyDecision.decision, "check");
    assert.notEqual(result.execution, undefined);
    assert.equal(result.execution!.status, "executed");
  });

  // T10: Delete succeeds but downstream mismatch → obligation breached
  it("T10: obligation breached on downstream mismatch", () => {
    // Register a verifier that reports breach
    harness.obligations.registerVerifier("delete_verification", () => "breached");

    const proposal = makeProposal({
      actionType: "DeleteRows",
      args: {
        connectionId: "db:main",
        table: "users",
        predicate: "id = 42",
        dryRunCount: 1,
        backupRef: "backup:snap",
      },
    });

    harness.process(proposal, cleanResolution(), { now: NOW, approved: true });

    const events = harness.sweepObligations(FUTURE);
    assert.ok(events.some((e) => e.kind === "breached"));
    assert.ok(
      events.some(
        (e) =>
          e.kind === "breached" &&
          e.failureMode.includes("Downstream counts"),
      ),
    );
  });
});

describe("ScheduleMeeting", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = new Harness();
    resetActionCounter();
  });

  // T11: Ambiguous attendee → clarify
  it("T11: clarify on attendee ambiguity", () => {
    const proposal = makeProposal({
      actionType: "ScheduleMeeting",
      args: {
        attendeeIds: ["person:alice", "person:bob"],
        startTime: FUTURE,
        durationMinutes: 30,
        purpose: "standup",
      },
    });

    const resolution = cleanResolution({
      conflicts: ["person:bob matches person:robert"],
    });

    const result = harness.evaluate(proposal, resolution, NOW);
    assert.equal(result.policyDecision.decision, "clarify");
    assert.ok(result.policyDecision.blockers.includes("entity_resolution_conflict"));
  });

  // T12: Hard conflict, no fallback → deny via check failure
  it("T12: no execution when calendar check fails", () => {
    harness.registry.registerCheck("calendar_lookup", () => ({
      checkId: "calendar_lookup",
      passed: false,
      detail: "Required attendee has hard conflict",
    }));

    const proposal = makeProposal({
      actionType: "ScheduleMeeting",
      args: {
        attendeeIds: ["person:alice"],
        startTime: FUTURE,
        durationMinutes: 30,
        purpose: "standup",
      },
    });

    const result = harness.process(proposal, cleanResolution(), { now: NOW });
    assert.equal(result.evaluation.policyDecision.decision, "check");
    assert.equal(result.execution, undefined);
  });

  // T13: Clear attendees, available slot → allow, obligation open
  it("T13: execute and create obligation on success", () => {
    const proposal = makeProposal({
      actionType: "ScheduleMeeting",
      args: {
        attendeeIds: ["person:alice", "person:bob"],
        startTime: FUTURE,
        durationMinutes: 30,
        purpose: "standup",
      },
    });

    const result = harness.process(
      proposal,
      cleanResolution({
        entityIds: ["person:alice", "person:bob"],
        semanticKeys: ["meeting"],
        entitySlots: { attendeeIds: ["person:alice", "person:bob"] },
      }),
      { now: NOW },
    );
    assert.notEqual(result.execution, undefined);
    assert.equal(result.execution!.status, "executed");
    assert.equal(result.execution!.effect!.obligations.length, 1);
    assert.equal(result.execution!.effect!.obligations[0].status, "open");
    assert.equal(result.execution!.effect!.obligations[0].kind, "meeting_response");
    assert.deepEqual(result.execution!.effect!.obligations[0].entityIds, ["person:alice", "person:bob"]);
  });
});

describe("Schema and Registry", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = new Harness();
    resetActionCounter();
  });

  // T14: Two incompatible schemas for high-cost action → clarify
  it("T14: clarify on schema competition", () => {
    const proposal = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        validUntil: FUTURE,
        termsVersion: "v2",
      },
      blockers: ["schema_competition"],
    });

    const result = harness.evaluate(proposal, cleanResolution(), NOW);
    assert.equal(result.policyDecision.decision, "clarify");
    assert.ok(result.policyDecision.blockers.includes("schema_competition"));
  });

  // T15: Multiple variants sharing safe first step → check on intersection
  it("T15: check when cheap checks exist and no blockers", () => {
    // This scenario maps to the policy returning "check" when there are
    // cheap checks but no blockers — the intersection action is the safe step.
    const proposal = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        validUntil: FUTURE,
        termsVersion: "v2",
      },
    });

    const result = harness.evaluate(proposal, cleanResolution(), NOW);
    assert.equal(result.policyDecision.decision, "check");
    assert.ok(result.policyDecision.requiredChecks.includes("pricing_source_lookup"));
  });

  // T16: Unregistered action type → deny
  it("T16: deny on unregistered action type", () => {
    const proposal = makeProposal({
      actionType: "LaunchMissiles",
      args: { target: "moon" },
    });

    const result = harness.evaluate(proposal, cleanResolution(), NOW);
    assert.equal(result.policyDecision.decision, "deny");
    assert.ok(result.policyDecision.reasonCodes.includes("unregistered_action_type"));
  });

  // T17: Freeform request, no typed action → no execution proposal
  it("T17: no execution for information-only request", () => {
    // Simulated by an empty proposal with no actionType match
    const proposal = makeProposal({
      actionType: "InformationRequest",
      args: { query: "What is the current price?" },
    });

    const result = harness.process(proposal, cleanResolution(), { now: NOW });
    assert.equal(result.evaluation.policyDecision.decision, "deny");
    assert.equal(result.execution, undefined);
  });
});

describe("Obligation Projection", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = new Harness();
    resetActionCounter();
  });

  // T18: Old obligation on same entity → projected into context
  it("T18: project intersecting obligation into evaluation", () => {
    // First action creates an obligation
    const first = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        validUntil: FUTURE,
        termsVersion: "v2",
      },
    });
    const res = cleanResolution();
    harness.process(first, res, { now: NOW });

    // Second action on same entity — should see the obligation
    const second = makeProposal({
      actionType: "ScheduleMeeting",
      args: {
        attendeeIds: ["client:123"],
        startTime: FUTURE,
        durationMinutes: 30,
        purpose: "follow up on quote",
      },
    });

    const result = harness.evaluate(second, res, NOW);
    assert.ok(result.projectedObligations.length > 0);
    assert.equal(result.projectedObligations[0].kind, "quote_acknowledgement");
  });

  // T19: Unrelated obligation on different entity → not projected
  it("T19: no projection for unrelated obligations", () => {
    // Create obligation on client:123
    const first = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        validUntil: FUTURE,
        termsVersion: "v2",
      },
    });
    harness.process(first, cleanResolution(), { now: NOW });

    // Different entity entirely
    const second = makeProposal({
      actionType: "ScheduleMeeting",
      args: {
        attendeeIds: ["person:dave"],
        startTime: FUTURE,
        durationMinutes: 30,
        purpose: "unrelated meeting",
      },
    });

    const differentRes: Resolution = {
      entityIds: ["person:dave"],
      resourceKeys: ["calendar:dave"],
      semanticKeys: ["meeting"],
      conflicts: [],
      entitySlots: { attendeeIds: ["person:dave"] },
      resourceSlots: {},
    };

    const result = harness.evaluate(second, differentRes, NOW);
    assert.equal(result.projectedObligations.length, 0);
    assert.equal(result.projectedCommitments.length, 0);
  });
});

describe("Safety Budget", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = new Harness();
    resetActionCounter();
  });

  // T20: High-cost action with fast feedback → no tier-3 sampling
  it("T20: no extra checks for fast-feedback actions", () => {
    // Register a fast-feedback, high-cost action
    harness.registry.register({
      actionType: "FastHighCost",
      version: "1",
      requiredArgs: ["target"],
      blastRadius: "high",
      reversible: true, // reversible, so no approve gate
      feedbackLatency: "fast",
      cheapChecks: [],
      approvalPolicy: "never",
      preconditions: [],
      entitySelectors: [],
      resourceSelectors: [],
      effectTemplate: (_args, _res, _now) => ({
        mutations: [{ resource: "test", op: "test", summary: "test" }],
        commitments: [],
        obligations: [],
      }),
    });

    const proposal = makeProposal({
      actionType: "FastHighCost",
      args: { target: "x" },
    });

    const result = harness.evaluate(proposal, cleanResolution(), NOW);
    // Should allow directly — no extra checks, no approve gate
    assert.equal(result.policyDecision.decision, "allow");
    assert.equal(result.policyDecision.requiredChecks.length, 0);
  });
});

describe("Regression checks", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = new Harness();
    resetActionCounter();
  });

  it("adapter without policy cannot execute (guaranteed by registry + policy)", () => {
    // An adapter registered without preconditions still goes through policy
    harness.registry.register({
      actionType: "BareAdapter",
      version: "1",
      requiredArgs: ["x"],
      blastRadius: "low",
      reversible: true,
      feedbackLatency: "fast",
      cheapChecks: [],
      approvalPolicy: "never",
      preconditions: [],
      entitySelectors: [],
      resourceSelectors: [],
      effectTemplate: (_a, _r, _n) => ({
        mutations: [{ resource: "t", op: "t", summary: "t" }],
        commitments: [],
        obligations: [],
      }),
    });

    // Missing required arg → clarify, not allow
    const proposal = makeProposal({ actionType: "BareAdapter", args: {} });
    const result = harness.evaluate(proposal, cleanResolution(), NOW);
    assert.equal(result.policyDecision.decision, "clarify");
  });

  it("passed check cannot override a hard deny", () => {
    // DeleteRows with empty predicate → deny, even if checks would pass
    const proposal = makeProposal({
      actionType: "DeleteRows",
      args: {
        connectionId: "db:main",
        table: "users",
        predicate: "", // empty → deny
        dryRunCount: 1,
      },
    });

    const result = harness.process(proposal, cleanResolution(), { now: NOW });
    assert.equal(result.evaluation.policyDecision.decision, "deny");
    assert.equal(result.execution, undefined);
  });

  it("expired commitments no longer block new actions", () => {
    // Create a quote that expires in the past
    const first = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        validUntil: PAST, // already expired
        termsVersion: "v2",
      },
    });
    harness.process(first, cleanResolution(), { now: "2026-02-01T00:00:00.000Z" });

    // New quote with different price — should NOT be blocked because old one expired
    const second = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 200,
        currency: "USD",
        validUntil: FUTURE,
        termsVersion: "v3",
      },
    });

    const result = harness.evaluate(second, cleanResolution(), NOW);
    // Should not be denied — the old commitment expired
    assert.notEqual(result.policyDecision.decision, "deny");
  });

  it("quote commitment captures the full typed contract", () => {
    const proposal = makeProposal({
      actionType: "SendQuoteEmail",
      args: {
        recipientId: "client:123",
        productId: "product:abc",
        unitPrice: 100,
        currency: "USD",
        validUntil: FUTURE,
        termsVersion: "v2",
      },
    });

    const result = harness.process(proposal, cleanResolution(), { now: NOW });
    const fields = result.execution!.effect!.commitments[0].fields;
    assert.equal(fields.recipientId, "client:123");
    assert.equal(fields.productId, "product:abc");
    assert.equal(fields.validUntil, FUTURE);
  });

  it("delete mutations record the target table in the summary", () => {
    const proposal = makeProposal({
      actionType: "DeleteRows",
      args: {
        connectionId: "db:main",
        table: "users",
        predicate: "status = 'inactive'",
        dryRunCount: 5,
      },
    });

    const result = harness.process(proposal, cleanResolution(), { now: NOW, approved: true });
    assert.match(result.execution!.effect!.mutations[0].summary, /Delete rows from users where/);
  });

  it("approve enforces required checks — failing check blocks execution", () => {
    // Register a failing dry run
    harness.registry.registerCheck("sql_dry_run", () => ({
      checkId: "sql_dry_run",
      passed: false,
      detail: "Schema mismatch detected",
    }));

    const proposal = makeProposal({
      actionType: "DeleteRows",
      args: {
        connectionId: "db:main",
        table: "users",
        predicate: "status = 'inactive'",
        dryRunCount: 50000,
      },
    });

    const result = harness.process(proposal, cleanResolution(), { now: NOW, approved: true });
    assert.equal(result.evaluation.policyDecision.decision, "approve");
    // Checks ran and failed — execution must be blocked
    assert.ok(result.evaluation.checkResults.some((r) => !r.passed));
    assert.equal(result.execution, undefined);
  });

  it("effect emission is guaranteed on execution", () => {
    const proposal = makeProposal({
      actionType: "ScheduleMeeting",
      args: {
        attendeeIds: ["person:alice"],
        startTime: FUTURE,
        durationMinutes: 30,
        purpose: "standup",
      },
    });

    const result = harness.process(proposal, cleanResolution(), { now: NOW });
    assert.notEqual(result.execution, undefined);
    assert.notEqual(result.execution!.effect, undefined);
    assert.ok(result.execution!.effect!.mutations.length > 0);
    assert.equal(harness.store.all().length, 1);
  });
});
