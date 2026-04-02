import type {
  Proposal,
  Resolution,
  ActionSpec,
  PolicyDecision,
  Blocker,
  Commitment,
} from "./types.ts";
import type { EffectStore } from "./effect-store.ts";

/**
 * Policy Engine — evaluates a proposal against the action spec, resolution,
 * and existing effects to produce a deterministic decision.
 *
 * Decision order (from spec):
 *  1. Validate required fields
 *  2. Validate entity/resource resolution
 *  3. Query effect store for intersecting commitments/obligations
 *  4. Evaluate preconditions and cheap checks
 *  5. Choose cheapest safe decision
 */
export function evaluate(input: {
  proposal: Proposal;
  resolution: Resolution;
  spec: ActionSpec;
  store: EffectStore;
  now?: string;
}): PolicyDecision {
  const { proposal, resolution, spec, store } = input;
  const nowIso = input.now ?? new Date().toISOString();
  const blockers = new Set<Blocker>(proposal.blockers);
  const reasonCodes: string[] = [];

  // 1. Required field validation
  for (const arg of spec.requiredArgs) {
    const v = proposal.args[arg];
    if (v === undefined || v === null || v === "") {
      blockers.add("missing_required_arg");
      reasonCodes.push(`missing:${arg}`);
    }
  }

  // 2. Resolution conflicts
  if (resolution.conflicts.length > 0) {
    blockers.add("entity_resolution_conflict");
    for (const c of resolution.conflicts) {
      reasonCodes.push(`resolution_conflict:${c}`);
    }
  }

  // 3. Effect store intersection — commitments and obligations
  const intersecting = store.queryIntersection(
    {
      actionType: proposal.actionType,
      entityIds: resolution.entityIds,
      resourceKeys: resolution.resourceKeys,
      semanticKeys: resolution.semanticKeys,
    },
    nowIso,
  );

  if (hasCommitmentConflict(proposal, intersecting.commitments)) {
    blockers.add("commitment_conflict");
    reasonCodes.push("open_commitment_conflict");
  }

  // 4. Adapter preconditions
  for (const precondition of spec.preconditions) {
    const result = precondition(proposal, resolution);
    if (!result.ok) {
      blockers.add(result.blocker);
      reasonCodes.push(result.reason);
    }
  }

  // --- Decision routing (cheapest safe action) ---

  // Hard deny: commitment conflicts or blast radius violations
  if (blockers.has("commitment_conflict") || blockers.has("blast_radius_exceeds_limit")) {
    return {
      decision: "deny",
      blockers: [...blockers],
      requiredChecks: [],
      reasonCodes,
    };
  }

  // Clarify: schema competition, entity conflicts, or missing args
  if (
    blockers.has("schema_competition") ||
    blockers.has("entity_resolution_conflict") ||
    blockers.has("missing_required_arg")
  ) {
    return {
      decision: "clarify",
      blockers: [...blockers],
      requiredChecks: [],
      reasonCodes,
    };
  }

  // Approve: adapter-owned gate or default high-risk heuristic
  const needsApproval = (() => {
    if (spec.approvalPolicy === "never") return false;
    if (spec.approvalPolicy === "always") return true;
    if (spec.requiresApproval) return spec.requiresApproval(proposal, resolution);
    return spec.blastRadius === "high" && !spec.reversible;
  })();

  if (needsApproval) {
    const approveChecks = spec.cheapChecks
      .filter((c) => c.requiredFor.length === 0 || c.requiredFor.includes("approve"))
      .map((c) => c.id);
    return {
      decision: "approve",
      blockers: [...blockers],
      requiredChecks: approveChecks,
      reasonCodes: [...reasonCodes, "high_risk_irreversible"],
    };
  }

  // Check: cheap checks required before allow
  const checksForAllow = spec.cheapChecks.filter((c) =>
    c.requiredFor.includes("allow"),
  );
  if (checksForAllow.length > 0) {
    return {
      decision: "check",
      blockers: [...blockers],
      requiredChecks: checksForAllow.map((c) => c.id),
      reasonCodes: [...reasonCodes, "cheap_checks_required"],
    };
  }

  // Allow: everything passes
  return {
    decision: "allow",
    blockers: [...blockers],
    requiredChecks: [],
    reasonCodes,
  };
}

/**
 * Detect commitment conflicts for the proposal.
 * For SendQuoteEmail: conflicts when an open quote exists for the same
 * entities but with different price or terms.
 */
function hasCommitmentConflict(
  proposal: Proposal,
  commitments: Commitment[],
): boolean {
  if (proposal.actionType === "SendQuoteEmail") {
    const proposedPrice = proposal.args.unitPrice;
    const proposedTerms = proposal.args.termsVersion;
    for (const c of commitments) {
      if (c.kind !== "quote") continue;
      if (
        c.fields.unitPrice !== proposedPrice ||
        c.fields.termsVersion !== proposedTerms
      ) {
        return true;
      }
    }
  }
  return false;
}
