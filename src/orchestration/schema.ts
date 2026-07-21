import { Type, type TProperties } from "typebox";

const Base = { cwd: Type.String({ minLength: 1 }) };
const Change = { ...Base, changeId: Type.String({ minLength: 1 }) };
const HandoffMode = Type.Union([Type.Literal("managed"), Type.Literal("inline")]);
const ReviewCampaign = { reviewCampaignId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) };
const ImplementationCampaign = {
  implementationCampaignId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  taskScope: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  workKind: Type.Optional(Type.Union([Type.Literal("implementation"), Type.Literal("research"), Type.Literal("test"), Type.Literal("fix"), Type.Literal("review")])),
};
const Task = Type.Object({
  name: Type.String({ minLength: 1 }), agent: Type.String({ minLength: 1 }),
  modelSlot: Type.String({ minLength: 1 }), task: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
const Evidence = Type.Object({
  command: Type.String({ minLength: 1, maxLength: 500 }), exitCode: Type.Number(),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  summary: Type.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false });
const Waiver = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 500 }),
  alternativeEvidence: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 20 }),
}, { additionalProperties: false });
const strict = (properties: TProperties) => Type.Object(properties, { additionalProperties: false });

export const horsepowerActionSchemas = {
  single: strict({ action: Type.Literal("single"), ...Change, ...ReviewCampaign, ...ImplementationCampaign, handoffMode: HandoffMode, name: Type.String({ minLength: 1 }), agent: Type.String({ minLength: 1 }), modelSlot: Type.String({ minLength: 1 }), task: Type.String({ minLength: 1 }) }),
  parallel: strict({ action: Type.Literal("parallel"), ...Change, ...ReviewCampaign, ...ImplementationCampaign, handoffMode: HandoffMode, tasks: Type.Array(Task, { minItems: 1, maxItems: 8 }) }),
  chain: strict({ action: Type.Literal("chain"), ...Change, ...ReviewCampaign, ...ImplementationCampaign, handoffMode: HandoffMode, tasks: Type.Array(Task, { minItems: 1, maxItems: 8 }) }),
  create: strict({ action: Type.Literal("create"), ...Change, ...ReviewCampaign, ...ImplementationCampaign, handoffMode: HandoffMode, name: Type.String({ minLength: 1 }), agent: Type.String({ minLength: 1 }), modelSlot: Type.String({ minLength: 1 }), brief: Type.Optional(Type.String({ minLength: 1 })) }),
  send: strict({ action: Type.Literal("send"), ...Change, ...ReviewCampaign, ...ImplementationCampaign, handoffMode: HandoffMode, workerId: Type.String({ minLength: 1 }), message: Type.String({ minLength: 1 }), delivery: Type.Optional(Type.Union([Type.Literal("reject"), Type.Literal("followUp")])), wait: Type.Optional(Type.Boolean()), timeoutMs: Type.Optional(Type.Number({ minimum: 1 })) }),
  steer: strict({ action: Type.Literal("steer"), ...Change, ...ReviewCampaign, ...ImplementationCampaign, workerId: Type.String({ minLength: 1 }), message: Type.String({ minLength: 1 }), wait: Type.Optional(Type.Boolean()), timeoutMs: Type.Optional(Type.Number({ minimum: 1 })) }),
  status: strict({ action: Type.Literal("status"), ...Base, workerId: Type.String({ minLength: 1 }) }),
  list: strict({ action: Type.Literal("list"), ...Base }),
  read: strict({ action: Type.Literal("read"), ...Base, workerId: Type.String({ minLength: 1 }), afterCursor: Type.Optional(Type.Number({ minimum: 0 })), includeDetails: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })) }),
  abort: strict({ action: Type.Literal("abort"), ...Base, workerId: Type.String({ minLength: 1 }) }),
  destroy: strict({ action: Type.Literal("destroy"), ...Base, workerId: Type.String({ minLength: 1 }), force: Type.Optional(Type.Boolean()) }),
  doctor: strict({ action: Type.Literal("doctor"), ...Base }),
  begin_change: strict({ action: Type.Literal("begin_change"), ...Change }),
  report_terminal: strict({ action: Type.Literal("report_terminal"), ...Change, runId: Type.String({ minLength: 1 }), status: Type.Union([Type.Literal("completed"), Type.Literal("blocked_needs_human"), Type.Literal("failed"), Type.Literal("canceled")]), summary: Type.String({ minLength: 1, maxLength: 500 }), e2e: Type.Optional(Type.Array(Evidence, { minItems: 1, maxItems: 8 })), e2eWaiver: Type.Optional(Waiver), evidenceRefs: Type.Optional(Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 20 })) }),
  begin_review_campaign: strict({ action: Type.Literal("begin_review_campaign"), ...Change, acceptanceScope: Type.String({ minLength: 1, maxLength: 4_096 }), budget: Type.Integer({ minimum: 1 }) }),
  record_review_finding: strict({ action: Type.Literal("record_review_finding"), ...Change, campaignId: Type.String({ minLength: 1, maxLength: 128 }), rootCauseId: Type.String({ minLength: 1, maxLength: 128 }), summary: Type.String({ minLength: 1, maxLength: 500 }), scope: Type.Union([Type.Literal("in_scope"), Type.Literal("out_of_scope")]), evidenceRef: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })) }),
  extend_review_campaign: strict({ action: Type.Literal("extend_review_campaign"), ...Change, campaignId: Type.String({ minLength: 1, maxLength: 128 }), additionalBudget: Type.Integer({ minimum: 1 }), humanAuthorized: Type.Literal(true), reason: Type.String({ minLength: 1, maxLength: 500 }) }),
  end_review_campaign: strict({ action: Type.Literal("end_review_campaign"), ...Change, campaignId: Type.String({ minLength: 1, maxLength: 128 }), outcome: Type.Union([Type.Literal("accepted"), Type.Literal("scope_changed"), Type.Literal("blocked_needs_human"), Type.Literal("canceled")]), summary: Type.String({ minLength: 1, maxLength: 500 }) }),
  review_campaign_status: strict({ action: Type.Literal("review_campaign_status"), ...Base, campaignId: Type.String({ minLength: 1, maxLength: 128 }) }),
} as const;

export const horsepowerSubagentSchema = Type.Union(Object.values(horsepowerActionSchemas));
