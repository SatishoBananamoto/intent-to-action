/**
 * Interpreter. Maps structured requests to typed proposals with resolution.
 *
 * Parallels the Python harness interpreter — handles selector cardinality,
 * per-item ambiguity, and slot-level resolution.
 */

import type {
  Proposal,
  Resolution,
  Blocker,
  SelectorCardinality,
  SelectorSpec,
} from "./types.ts";

type SelectorCandidates = (string | string[])[];

type SelectorMap = Record<string, SelectorCandidates>;

let interpreterCounter = 0;

export function resetInterpreterCounter(): void {
  interpreterCounter = 0;
}

/**
 * Build a typed proposal and resolution from a structured request.
 *
 * entityMap:
 *   - one-selector: ["entity:1"] or ["entity:1", "entity:2"] (ambiguous)
 *   - many-selector: [["entity:1"], ["entity:2"]] where each inner list
 *     represents candidates for one requested item
 *
 * resourceMap follows the same convention.
 */
export function interpret(input: {
  actionType: string;
  args: Record<string, unknown>;
  entityMap?: SelectorMap;
  resourceMap?: SelectorMap;
  semanticKeys?: string[];
  entitySelectors?: SelectorSpec[];
  resourceSelectors?: SelectorSpec[];
}): { proposal: Proposal; resolution: Resolution } {
  const proposalId = `proposal:${++interpreterCounter}:${Date.now()}`;
  const blockers: Blocker[] = [];

  const entitySpecs = new Map(
    (input.entitySelectors ?? []).map((s) => [s.name, s]),
  );
  const resourceSpecs = new Map(
    (input.resourceSelectors ?? []).map((s) => [s.name, s]),
  );

  const {
    resolved: entityIds,
    slots: entitySlots,
    conflicts: entityConflicts,
  } = resolveSelectorMap(input.entityMap ?? {}, entitySpecs);

  const {
    resolved: resourceKeys,
    slots: resourceSlots,
    conflicts: resourceConflicts,
  } = resolveSelectorMap(input.resourceMap ?? {}, resourceSpecs);

  const conflicts = [...entityConflicts, ...resourceConflicts];

  return {
    proposal: {
      proposalId,
      actionType: input.actionType,
      args: input.args,
      evidenceRefs: [],
      blockers,
    },
    resolution: {
      entityIds,
      resourceKeys,
      semanticKeys: input.semanticKeys ?? [],
      conflicts,
      entitySlots,
      resourceSlots,
    },
  };
}

function resolveSelectorMap(
  selectorMap: SelectorMap,
  specs: Map<string, SelectorSpec>,
): {
  resolved: string[];
  slots: Record<string, string[]>;
  conflicts: string[];
} {
  const resolved: string[] = [];
  const slots: Record<string, string[]> = {};
  const conflicts: string[] = [];

  for (const [name, rawCandidates] of Object.entries(selectorMap)) {
    const spec = specs.get(name);
    const cardinality: SelectorCardinality = spec?.cardinality ?? "one";
    const slotValues: string[] = [];

    if (cardinality === "many") {
      const groups = candidateGroups(rawCandidates);
      if (groups.length === 0) {
        conflicts.push(`no_match:${name}`);
      }
      for (let i = 0; i < groups.length; i++) {
        const candidates = groups[i];
        if (candidates.length === 0) {
          conflicts.push(`no_match:${name}[${i}]`);
        } else if (candidates.length === 1) {
          appendUnique(slotValues, candidates[0]);
        } else {
          conflicts.push(`ambiguous:${name}[${i}]:${candidates.join(",")}`);
        }
      }
    } else {
      const candidates = flattenCandidates(rawCandidates);
      if (candidates.length === 0) {
        conflicts.push(`no_match:${name}`);
      } else if (candidates.length === 1) {
        slotValues.push(candidates[0]);
      } else {
        conflicts.push(`ambiguous:${name}:${candidates.join(",")}`);
      }
    }

    if (slotValues.length > 0) {
      slots[name] = slotValues;
      for (const v of slotValues) {
        appendUnique(resolved, v);
      }
    }
  }

  return { resolved, slots, conflicts };
}

function candidateGroups(raw: SelectorCandidates): string[][] {
  return raw.map((item) => (Array.isArray(item) ? item : [item]));
}

function flattenCandidates(raw: SelectorCandidates): string[] {
  const flat: string[] = [];
  for (const group of candidateGroups(raw)) {
    flat.push(...group);
  }
  return flat;
}

function appendUnique(arr: string[], value: string): void {
  if (!arr.includes(value)) arr.push(value);
}
