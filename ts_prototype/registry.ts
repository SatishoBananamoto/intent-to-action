import type {
  ActionSpec,
  Proposal,
  Resolution,
  Blocker,
  CheckRunner,
  CheckResult,
} from "./types.ts";

// --- Arg helpers ---

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`Missing string arg: ${key}`);
  return v;
}

function requireNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number") throw new Error(`Missing number arg: ${key}`);
  return v;
}

// --- Adapter definitions ---

const SendQuoteEmail: ActionSpec = {
  actionType: "SendQuoteEmail",
  version: "1",
  requiredArgs: ["recipientId", "productId", "unitPrice", "currency", "validUntil", "termsVersion"],
  blastRadius: "medium",
  reversible: false,
  feedbackLatency: "slow",
  approvalPolicy: "if_high_risk",
  cheapChecks: [{ id: "pricing_source_lookup", kind: "lookup", requiredFor: ["allow"] }],
  preconditions: [],
  entitySelectors: [{ name: "recipientId", cardinality: "one" }],
  resourceSelectors: [{ name: "productId", cardinality: "one" }],
  effectTemplate: (args, resolution, nowIso) => ({
    mutations: [
      {
        resource: "email",
        op: "send_quote",
        summary: `Quote sent to ${requireString(args, "recipientId")}`,
      },
    ],
    commitments: [
      {
        commitmentId: `commitment:${nowIso}:quote`,
        kind: "quote",
        entityIds: resolution.entityIds,
        resourceKeys: resolution.resourceKeys,
        semanticKeys: resolution.semanticKeys,
        fields: {
          recipientId: requireString(args, "recipientId"),
          productId: requireString(args, "productId"),
          unitPrice: requireNumber(args, "unitPrice"),
          currency: requireString(args, "currency"),
          validUntil: requireString(args, "validUntil"),
          termsVersion: requireString(args, "termsVersion"),
        },
        expiresAt: requireString(args, "validUntil"),
      },
    ],
    obligations: [
      {
        obligationId: `obligation:${nowIso}:quote_ack`,
        kind: "quote_acknowledgement",
        entityIds: resolution.entityIds,
        resourceKeys: resolution.resourceKeys,
        semanticKeys: resolution.semanticKeys,
        dueAt: requireString(args, "validUntil"),
        verifyWith: "human",
        failureMode: "No acknowledgement or reply before quote expiry",
        status: "open",
      },
    ],
  }),
};

const DeleteRows: ActionSpec = {
  actionType: "DeleteRows",
  version: "1",
  requiredArgs: ["connectionId", "table", "predicate", "dryRunCount"],
  blastRadius: "high",
  reversible: false,
  feedbackLatency: "slow",
  approvalPolicy: "if_high_risk",
  cheapChecks: [{ id: "sql_dry_run", kind: "dry_run", requiredFor: ["allow", "approve"] }],
  requiresApproval: (proposal: Proposal, _resolution: Resolution) => {
    const backupRef = proposal.args.backupRef;
    return typeof backupRef !== "string" || backupRef.trim() === "";
  },
  preconditions: [
    // T7: Deny if predicate is empty
    (proposal: Proposal, _resolution: Resolution) => {
      const pred = proposal.args.predicate;
      if (typeof pred !== "string" || pred.trim() === "") {
        return { ok: false as const, blocker: "blast_radius_exceeds_limit" as Blocker, reason: "empty_predicate" };
      }
      return { ok: true as const };
    },
  ],
  entitySelectors: [],
  resourceSelectors: [],
  effectTemplate: (args, resolution, nowIso) => ({
    mutations: [
      {
        resource: requireString(args, "table"),
        op: "delete_rows",
        summary: `Delete rows from ${requireString(args, "table")} where ${requireString(args, "predicate")}`,
      },
    ],
    commitments: [],
    obligations: [
      {
        obligationId: `obligation:${nowIso}:delete_verify`,
        kind: "delete_verification",
        entityIds: resolution.entityIds,
        resourceKeys: resolution.resourceKeys,
        semanticKeys: resolution.semanticKeys,
        dueAt: nowIso,
        verifyWith: "query",
        failureMode: "Downstream counts or replication diverged after delete",
        status: "open",
      },
    ],
  }),
};

const ScheduleMeeting: ActionSpec = {
  actionType: "ScheduleMeeting",
  version: "1",
  requiredArgs: ["attendeeIds", "startTime", "durationMinutes", "purpose"],
  blastRadius: "low",
  reversible: true,
  feedbackLatency: "slow",
  approvalPolicy: "never",
  cheapChecks: [{ id: "calendar_lookup", kind: "lookup", requiredFor: ["allow"] }],
  preconditions: [],
  entitySelectors: [{ name: "attendeeIds", cardinality: "many" }],
  resourceSelectors: [],
  effectTemplate: (args, resolution, nowIso) => ({
    mutations: [
      {
        resource: "calendar",
        op: "create_event",
        summary: `Meeting scheduled for ${requireString(args, "startTime")}`,
      },
    ],
    commitments: [],
    obligations: [
      {
        obligationId: `obligation:${nowIso}:meeting_response`,
        kind: "meeting_response",
        entityIds: resolution.entitySlots.attendeeIds ?? resolution.entityIds,
        resourceKeys: resolution.resourceKeys,
        semanticKeys: resolution.semanticKeys,
        dueAt: requireString(args, "startTime"),
        verifyWith: "poll",
        failureMode: "Required attendees declined or did not respond",
        status: "open",
      },
    ],
  }),
};

// --- Registry ---

export class ActionRegistry {
  private readonly specs = new Map<string, ActionSpec>();
  private readonly checkRunners = new Map<string, CheckRunner>();

  register(spec: ActionSpec): void {
    this.specs.set(spec.actionType, spec);
  }

  registerCheck(checkId: string, runner: CheckRunner): void {
    this.checkRunners.set(checkId, runner);
  }

  lookup(actionType: string): ActionSpec | undefined {
    return this.specs.get(actionType);
  }

  has(actionType: string): boolean {
    return this.specs.has(actionType);
  }

  runCheck(checkId: string, proposal: Proposal, resolution: Resolution): CheckResult {
    const runner = this.checkRunners.get(checkId);
    if (!runner) {
      return { checkId, passed: false, detail: `No runner registered for check: ${checkId}` };
    }
    return runner(proposal, resolution);
  }

  /** Create a registry pre-loaded with the three MVP adapters. */
  static withDefaults(): ActionRegistry {
    const reg = new ActionRegistry();
    reg.register(SendQuoteEmail);
    reg.register(DeleteRows);
    reg.register(ScheduleMeeting);

    // Default check runners (stubs for MVP — real adapters wire real lookups)
    reg.registerCheck("pricing_source_lookup", (_p, _r) => ({
      checkId: "pricing_source_lookup",
      passed: true,
      detail: "Price source is current",
    }));
    reg.registerCheck("sql_dry_run", (p, _r) => ({
      checkId: "sql_dry_run",
      passed: true,
      detail: `Dry run: ${p.args.dryRunCount} rows would be affected`,
    }));
    reg.registerCheck("calendar_lookup", (_p, _r) => ({
      checkId: "calendar_lookup",
      passed: true,
      detail: "No conflicts found",
    }));

    return reg;
  }
}
