import { Harness } from "./harness.ts";
import { resetActionCounter } from "./executor.ts";
import type { Proposal, Resolution } from "./types.ts";

const harness = new Harness();
resetActionCounter();

const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function banner(text: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${text}`);
  console.log("=".repeat(60));
}

function show(label: string, obj: unknown) {
  console.log(`\n  ${label}:`);
  console.log(JSON.stringify(obj, null, 2).split("\n").map((l) => `    ${l}`).join("\n"));
}

// --- Scenario 1: Successful quote ---

banner("Scenario 1: Send a valid quote");

const quoteProposal: Proposal = {
  proposalId: "demo:quote:1",
  actionType: "SendQuoteEmail",
  args: {
    recipientId: "client:acme",
    productId: "product:widget-pro",
    unitPrice: 49.99,
    currency: "USD",
    validUntil: FUTURE,
    termsVersion: "v2.1",
  },
  evidenceRefs: ["email-thread:12345"],
  blockers: [],
};

const quoteRes: Resolution = {
  entityIds: ["client:acme"],
  resourceKeys: ["product:widget-pro"],
  semanticKeys: ["quote"],
  conflicts: [],
  entitySlots: { recipientId: ["client:acme"] },
  resourceSlots: { productId: ["product:widget-pro"] },
};

const r1 = harness.process(quoteProposal, quoteRes, { now: NOW });
show("Policy Decision", r1.evaluation.policyDecision);
show("Execution", { status: r1.execution?.status, observations: r1.execution?.observations });
show("Persisted Commitment", r1.execution?.effect?.commitments[0]);
show("Open Obligation", r1.execution?.effect?.obligations[0]);

// --- Scenario 2: Conflicting quote ---

banner("Scenario 2: Attempt conflicting quote (different price, same client)");

const conflicting: Proposal = {
  proposalId: "demo:quote:2",
  actionType: "SendQuoteEmail",
  args: {
    recipientId: "client:acme",
    productId: "product:widget-pro",
    unitPrice: 39.99, // different price!
    currency: "USD",
    validUntil: FUTURE,
    termsVersion: "v2.1",
  },
  evidenceRefs: [],
  blockers: [],
};

const r2 = harness.process(conflicting, quoteRes, { now: NOW });
show("Policy Decision", r2.evaluation.policyDecision);
console.log(`\n  Executed: ${r2.execution !== undefined}`);

// --- Scenario 3: Dangerous delete ---

banner("Scenario 3: Delete with empty predicate (should be denied)");

const dangerousDelete: Proposal = {
  proposalId: "demo:delete:1",
  actionType: "DeleteRows",
  args: {
    connectionId: "db:production",
    table: "customers",
    predicate: "",
    dryRunCount: 0,
  },
  evidenceRefs: [],
  blockers: [],
};

const r3 = harness.process(dangerousDelete, cleanRes(), { now: NOW });
show("Policy Decision", r3.evaluation.policyDecision);
console.log(`\n  Executed: ${r3.execution !== undefined}`);

// --- Scenario 4: Safe delete with approval ---

banner("Scenario 4: Safe delete with approval");

const safeDelete: Proposal = {
  proposalId: "demo:delete:2",
  actionType: "DeleteRows",
  args: {
    connectionId: "db:production",
    table: "temp_imports",
    predicate: "created_at < '2026-01-01'",
    dryRunCount: 150,
    backupRef: "backup:2026-04-02",
  },
  evidenceRefs: [],
  blockers: [],
};

const r4 = harness.process(safeDelete, cleanRes(), { now: NOW, approved: true });
show("Policy Decision", r4.evaluation.policyDecision);
show("Execution", { status: r4.execution?.status, observations: r4.execution?.observations });

// --- Scenario 5: Obligation breach ---

banner("Scenario 5: Sweep obligations (quote from Scenario 1 is still open)");

// Fast-forward past the deadline
const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const events = harness.sweepObligations(farFuture);
show("Obligation Events", events);

// --- Summary ---

banner("Effect Store State");
console.log(`\n  Total effects persisted: ${harness.store.all().length}`);
for (const effect of harness.store.all()) {
  console.log(`    - ${effect.actionType} (${effect.actionId})`);
  console.log(`      Mutations: ${effect.mutations.map((m) => m.summary).join(", ")}`);
  console.log(`      Commitments: ${effect.commitments.length}`);
  console.log(`      Obligations: ${effect.obligations.map((o) => `${o.kind}[${o.status}]`).join(", ")}`);
}

function cleanRes(): Resolution {
  return {
    entityIds: ["db:production"],
    resourceKeys: ["table:customers"],
    semanticKeys: ["delete"],
    conflicts: [],
    entitySlots: {},
    resourceSlots: {},
  };
}
