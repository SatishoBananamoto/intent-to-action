import type {
  Proposal,
  Resolution,
  PolicyDecision,
  EvaluationResult,
  HarnessResult,
  CheckResult,
} from "./types.ts";
import { EffectStore } from "./effect-store.ts";
import { ActionRegistry } from "./registry.ts";
import { evaluate } from "./policy.ts";
import { execute, runChecks } from "./executor.ts";
import { ObligationEngine } from "./obligations.ts";

/**
 * The Harness — full intent-to-action pipeline.
 *
 * Pipeline:
 *   1. Interpret (caller provides typed Proposal + Resolution)
 *   2. Registry lookup — reject unregistered action types
 *   3. Policy evaluation — deterministic decision
 *   4. Check execution — if policy says "check"
 *   5. Execution — if policy allows (or checks pass)
 *   6. Effect persistence — append to store
 *   7. Obligation tracking — via obligation engine
 */
export class Harness {
  readonly registry: ActionRegistry;
  readonly store: EffectStore;
  readonly obligations: ObligationEngine;

  constructor(input?: {
    registry?: ActionRegistry;
    store?: EffectStore;
    obligations?: ObligationEngine;
  }) {
    this.registry = input?.registry ?? ActionRegistry.withDefaults();
    this.store = input?.store ?? new EffectStore();
    this.obligations = input?.obligations ?? new ObligationEngine();
  }

  /**
   * Evaluate a proposal without executing.
   * Returns the policy decision, projected constraints, and check results.
   */
  evaluate(proposal: Proposal, resolution: Resolution, now?: string): EvaluationResult {
    const nowIso = now ?? new Date().toISOString();
    const spec = this.registry.lookup(proposal.actionType);

    // T16: Unregistered action type
    if (!spec) {
      return {
        proposal,
        resolution,
        policyDecision: {
          decision: "deny",
          blockers: [],
          requiredChecks: [],
          reasonCodes: ["unregistered_action_type"],
        },
        checkResults: [],
        projectedCommitments: [],
        projectedObligations: [],
      };
    }

    // Query existing constraints
    const projected = this.store.queryIntersection(
      {
        actionType: proposal.actionType,
        entityIds: resolution.entityIds,
        resourceKeys: resolution.resourceKeys,
        semanticKeys: resolution.semanticKeys,
      },
      nowIso,
    );

    // Policy evaluation
    const policyDecision = evaluate({
      proposal,
      resolution,
      spec,
      store: this.store,
      now: nowIso,
    });

    // Run checks if policy requires them (check or approve decisions)
    let checkResults: CheckResult[] = [];
    const needsChecks = (policyDecision.decision === "check" || policyDecision.decision === "approve")
      && policyDecision.requiredChecks.length > 0;
    if (needsChecks) {
      const checkOutput = runChecks({
        checkIds: policyDecision.requiredChecks,
        proposal,
        resolution,
        registry: this.registry,
      });
      checkResults = checkOutput.results;
    }

    return {
      proposal,
      resolution,
      policyDecision,
      checkResults,
      projectedCommitments: projected.commitments,
      projectedObligations: projected.obligations,
    };
  }

  /**
   * Full pipeline: evaluate + execute if allowed.
   *
   * Execution happens when:
   *  - decision is "allow"
   *  - decision is "check" and all checks pass
   *
   * "clarify", "approve", and "deny" stop the pipeline — the caller
   * must handle these (ask user, get approval, etc.).
   */
  process(
    proposal: Proposal,
    resolution: Resolution,
    options?: { now?: string; approved?: boolean },
  ): HarnessResult {
    const nowIso = options?.now ?? new Date().toISOString();
    const evaluation = this.evaluate(proposal, resolution, nowIso);
    const decision = evaluation.policyDecision.decision;

    // Should we execute?
    let shouldExecute = false;
    const checksPass = evaluation.checkResults.length === 0
      || evaluation.checkResults.every((r) => r.passed);

    if (decision === "allow") {
      shouldExecute = true;
    } else if (decision === "check") {
      shouldExecute = checksPass;
    } else if (decision === "approve" && options?.approved) {
      shouldExecute = checksPass;
    }

    if (!shouldExecute) {
      return { evaluation };
    }

    const spec = this.registry.lookup(proposal.actionType)!;
    const executionResult = execute({
      proposal,
      resolution,
      spec,
      store: this.store,
      now: nowIso,
    });

    return { evaluation, execution: executionResult };
  }

  /**
   * Run obligation sweep — check due obligations.
   */
  sweepObligations(asOfIso?: string) {
    return this.obligations.sweep(this.store, asOfIso);
  }
}
