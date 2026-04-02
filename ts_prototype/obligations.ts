import type { Obligation } from "./types.ts";
import type { EffectStore } from "./effect-store.ts";

export type ObligationEvent =
  | { kind: "satisfied"; obligationId: string }
  | { kind: "breached"; obligationId: string; failureMode: string }
  | { kind: "escalation"; obligationId: string; suggestedAction: string };

export type ObligationVerifier = (obligation: Obligation) => "satisfied" | "breached" | "pending";

/**
 * Obligation Engine — checks due obligations, marks them satisfied or breached,
 * and produces escalation events.
 */
export class ObligationEngine {
  private readonly verifiers = new Map<string, ObligationVerifier>();

  /** Register a verifier for an obligation kind. */
  registerVerifier(kind: string, verifier: ObligationVerifier): void {
    this.verifiers.set(kind, verifier);
  }

  /**
   * Sweep: check all obligations due by the given time.
   * Returns events for satisfied, breached, and escalation.
   */
  sweep(store: EffectStore, asOfIso?: string): ObligationEvent[] {
    const now = asOfIso ?? new Date().toISOString();
    const due = store.openObligations(now);
    const events: ObligationEvent[] = [];

    for (const obligation of due) {
      const verifier = this.verifiers.get(obligation.kind);
      let status: "satisfied" | "breached" | "pending";

      if (verifier) {
        status = verifier(obligation);
      } else if (obligation.verifyWith === "human") {
        // Human-verified obligations that are past due with no verifier = breached
        status = isPastOrEqual(obligation.dueAt, now) ? "breached" : "pending";
      } else {
        // No verifier registered and past due = breached
        status = isPastOrEqual(obligation.dueAt, now) ? "breached" : "pending";
      }

      if (status === "satisfied") {
        store.updateObligationStatus(obligation.obligationId, "satisfied");
        events.push({ kind: "satisfied", obligationId: obligation.obligationId });
      } else if (status === "breached") {
        store.updateObligationStatus(obligation.obligationId, "breached");
        events.push({
          kind: "breached",
          obligationId: obligation.obligationId,
          failureMode: obligation.failureMode,
        });
        // Produce escalation
        events.push({
          kind: "escalation",
          obligationId: obligation.obligationId,
          suggestedAction: `Follow up: ${obligation.failureMode}`,
        });
      }
      // "pending" = not yet due or verifier says wait, no event
    }

    return events;
  }

  /**
   * Manually satisfy an obligation (e.g., human confirms receipt).
   */
  satisfy(store: EffectStore, obligationId: string): boolean {
    return store.updateObligationStatus(obligationId, "satisfied");
  }

  /**
   * Manually breach an obligation.
   */
  breach(store: EffectStore, obligationId: string): boolean {
    return store.updateObligationStatus(obligationId, "breached");
  }
}

function isPastOrEqual(timestamp: string, nowIso: string): boolean {
  return normalizeIso(timestamp) <= normalizeIso(nowIso);
}

function normalizeIso(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
}
