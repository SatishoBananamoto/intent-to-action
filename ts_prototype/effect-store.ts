import type { Effect, Commitment, Obligation } from "./types.ts";

export type IntersectionQuery = {
  actionType: string;
  entityIds: string[];
  resourceKeys: string[];
  semanticKeys: string[];
};

export type IntersectionResult = {
  commitments: Commitment[];
  obligations: Obligation[];
};

export class EffectStore {
  private readonly effects: Effect[] = [];

  append(effect: Effect): void {
    this.effects.push(effect);
  }

  all(): readonly Effect[] {
    return this.effects;
  }

  queryIntersection(input: IntersectionQuery, now?: string): IntersectionResult {
    const nowIso = now ?? new Date().toISOString();
    const entitySet = new Set(input.entityIds);
    const resourceSet = new Set(input.resourceKeys);
    const semanticSet = new Set(input.semanticKeys);

    const commitments: Commitment[] = [];
    const obligations: Obligation[] = [];

    for (const effect of this.effects) {
      for (const c of effect.commitments) {
        if (c.supersededBy) continue;
        if (c.expiresAt && isPast(c.expiresAt, nowIso)) continue;
        if (
          intersects(entitySet, c.entityIds) ||
          intersects(resourceSet, c.resourceKeys) ||
          intersects(semanticSet, c.semanticKeys)
        ) {
          commitments.push(c);
        }
      }

      for (const o of effect.obligations) {
        if (o.status !== "open") continue;
        if (
          intersects(entitySet, o.entityIds) ||
          intersects(resourceSet, o.resourceKeys) ||
          intersects(semanticSet, o.semanticKeys)
        ) {
          obligations.push(o);
        }
      }
    }

    return { commitments, obligations };
  }

  /** Find all open obligations, optionally filtered by due date. */
  openObligations(beforeIso?: string): Obligation[] {
    const result: Obligation[] = [];
    for (const effect of this.effects) {
      for (const o of effect.obligations) {
        if (o.status !== "open") continue;
        if (beforeIso && isPast(beforeIso, o.dueAt)) continue;
        result.push(o);
      }
    }
    return result;
  }

  /** Mutate obligation status in-place. Effects are append-only for mutations,
   *  but obligation status transitions are part of the lifecycle. */
  updateObligationStatus(
    obligationId: string,
    status: "satisfied" | "breached",
  ): boolean {
    for (const effect of this.effects) {
      for (const o of effect.obligations) {
        if (o.obligationId === obligationId && o.status === "open") {
          o.status = status;
          return true;
        }
      }
    }
    return false;
  }
}

function intersects(index: Set<string>, values: string[]): boolean {
  for (const v of values) {
    if (index.has(v)) return true;
  }
  return false;
}

function isPast(timestamp: string, nowIso: string): boolean {
  return normalizeIso(timestamp) < normalizeIso(nowIso);
}

function normalizeIso(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
}
