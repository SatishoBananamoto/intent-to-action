// Intent-to-Action Harness — Core Types

export type Blocker =
  | "missing_required_arg"
  | "entity_resolution_conflict"
  | "schema_competition"
  | "commitment_conflict"
  | "blast_radius_exceeds_limit";

export type PolicyDecisionKind =
  | "allow"
  | "check"
  | "clarify"
  | "approve"
  | "deny";

export type BlastRadius = "low" | "medium" | "high";
export type FeedbackLatency = "fast" | "slow" | "silent";
export type ApprovalPolicy = "never" | "if_high_risk" | "always";
export type ObligationStatus = "open" | "satisfied" | "breached";
export type VerifyMethod = "poll" | "query" | "human";
export type CheckKind = "query" | "dry_run" | "lookup" | "simulation";
export type SelectorCardinality = "one" | "many";

// --- Interpreter output ---

export type Proposal = {
  proposalId: string;
  actionType: string;
  args: Record<string, unknown>;
  evidenceRefs: string[];
  blockers: Blocker[];
  supersedes?: string;
};

// --- Resolver output ---

export type Resolution = {
  entityIds: string[];
  resourceKeys: string[];
  semanticKeys: string[];
  conflicts: string[];
  entitySlots: Record<string, string[]>;
  resourceSlots: Record<string, string[]>;
};

// --- Registry types ---

export type CheckMode = "local" | "external";

export type CheckSpec = {
  id: string;
  kind: CheckKind;
  requiredFor: ("allow" | "approve")[];
  mode?: CheckMode;
};

export type SelectorSpec = {
  name: string;
  cardinality: SelectorCardinality;
};

export type EffectTemplate = (
  args: Record<string, unknown>,
  resolution: Resolution,
  nowIso: string,
) => {
  mutations: Mutation[];
  commitments: Commitment[];
  obligations: Obligation[];
};

export type RequiresApprovalFn = (
  proposal: Proposal,
  resolution: Resolution,
) => boolean;

export type PreconditionFn = (
  proposal: Proposal,
  resolution: Resolution,
) => { ok: true } | { ok: false; blocker: Blocker; reason: string };

export type CheckRunner = (
  proposal: Proposal,
  resolution: Resolution,
) => CheckResult;

export type ActionSpec = {
  actionType: string;
  version: string;
  requiredArgs: string[];
  blastRadius: BlastRadius;
  reversible: boolean;
  feedbackLatency: FeedbackLatency;
  cheapChecks: CheckSpec[];
  approvalPolicy: ApprovalPolicy;
  preconditions: PreconditionFn[];
  effectTemplate: EffectTemplate;
  entitySelectors: SelectorSpec[];
  resourceSelectors: SelectorSpec[];
  requiresApproval?: RequiresApprovalFn;
};

// --- Policy output ---

export type PolicyDecision = {
  decision: PolicyDecisionKind;
  blockers: Blocker[];
  requiredChecks: string[];
  reasonCodes: string[];
};

// --- Check results ---

export type CheckResult = {
  checkId: string;
  passed: boolean;
  detail: string;
};

// --- Effects ---

export type Mutation = {
  resource: string;
  op: string;
  summary: string;
};

export type Commitment = {
  commitmentId: string;
  kind: string;
  entityIds: string[];
  resourceKeys: string[];
  semanticKeys: string[];
  fields: Record<string, string | number | boolean>;
  expiresAt?: string;
  supersededBy?: string;
};

export type Obligation = {
  obligationId: string;
  kind: string;
  entityIds: string[];
  resourceKeys: string[];
  semanticKeys: string[];
  dueAt: string;
  verifyWith: VerifyMethod;
  failureMode: string;
  status: ObligationStatus;
  sourceProposalId?: string;
};

export type Effect = {
  actionId: string;
  actionType: string;
  entityIds: string[];
  resourceKeys: string[];
  semanticKeys: string[];
  mutations: Mutation[];
  commitments: Commitment[];
  obligations: Obligation[];
  observedAt: string;
};

// --- Executor output ---

export type ExecutionResult = {
  actionId: string;
  status: "executed" | "failed";
  observations: string[];
  effect?: Effect;
};

// --- Harness pipeline ---

export type EvaluationResult = {
  proposal: Proposal;
  resolution: Resolution;
  policyDecision: PolicyDecision;
  checkResults: CheckResult[];
  projectedCommitments: Commitment[];
  projectedObligations: Obligation[];
};

export type HarnessResult = {
  evaluation: EvaluationResult;
  execution?: ExecutionResult;
};
