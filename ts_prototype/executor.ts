import type {
  Proposal,
  Resolution,
  ActionSpec,
  PolicyDecision,
  Effect,
  ExecutionResult,
  CheckResult,
} from "./types.ts";
import type { EffectStore } from "./effect-store.ts";
import type { ActionRegistry } from "./registry.ts";

let actionCounter = 0;

function nextActionId(): string {
  return `action:${++actionCounter}:${Date.now()}`;
}

/** Reset counter (for tests). */
export function resetActionCounter(): void {
  actionCounter = 0;
}

/**
 * Execute a proposal that has passed policy.
 *
 * The executor only runs when:
 *  - decision is "allow", OR
 *  - decision was "check" and all checks passed, OR
 *  - decision was "approve" and approval was granted
 *
 * The caller is responsible for ensuring these conditions are met.
 */
export function execute(input: {
  proposal: Proposal;
  resolution: Resolution;
  spec: ActionSpec;
  store: EffectStore;
  now?: string;
}): ExecutionResult {
  const { proposal, resolution, spec, store } = input;
  const nowIso = input.now ?? new Date().toISOString();
  const actionId = nextActionId();

  try {
    const partial = spec.effectTemplate(proposal.args, resolution, nowIso);
    const obligations = partial.obligations.map((obligation) => ({
      ...obligation,
      sourceProposalId: proposal.proposalId,
    }));

    const effect: Effect = {
      actionId,
      actionType: proposal.actionType,
      entityIds: resolution.entityIds,
      resourceKeys: resolution.resourceKeys,
      semanticKeys: resolution.semanticKeys,
      mutations: partial.mutations,
      commitments: partial.commitments,
      obligations,
      observedAt: nowIso,
    };

    store.append(effect);

    return {
      actionId,
      status: "executed",
      observations: effect.mutations.map((m) => m.summary),
      effect,
    };
  } catch (err) {
    return {
      actionId,
      status: "failed",
      observations: [err instanceof Error ? err.message : String(err)],
    };
  }
}

/**
 * Run checks and determine if execution can proceed.
 * Returns the check results and whether all passed.
 */
export function runChecks(input: {
  checkIds: string[];
  proposal: Proposal;
  resolution: Resolution;
  registry: ActionRegistry;
}): { results: CheckResult[]; allPassed: boolean } {
  const results: CheckResult[] = [];
  for (const checkId of input.checkIds) {
    const result = input.registry.runCheck(checkId, input.proposal, input.resolution);
    results.push(result);
  }
  return {
    results,
    allPassed: results.every((r) => r.passed),
  };
}
