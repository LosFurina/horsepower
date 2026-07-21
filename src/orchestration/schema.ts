import { Type, type TProperties } from "typebox";

const Base = { cwd: Type.String({ minLength: 1 }) };
const Change = { ...Base, changeId: Type.String({ minLength: 1 }) };
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
  single: strict({ action: Type.Literal("single"), ...Change, name: Type.String({ minLength: 1 }), agent: Type.String({ minLength: 1 }), modelSlot: Type.String({ minLength: 1 }), task: Type.String({ minLength: 1 }) }),
  parallel: strict({ action: Type.Literal("parallel"), ...Change, tasks: Type.Array(Task, { minItems: 1, maxItems: 8 }) }),
  chain: strict({ action: Type.Literal("chain"), ...Change, tasks: Type.Array(Task, { minItems: 1, maxItems: 8 }) }),
  create: strict({ action: Type.Literal("create"), ...Change, name: Type.String({ minLength: 1 }), agent: Type.String({ minLength: 1 }), modelSlot: Type.String({ minLength: 1 }) }),
  send: strict({ action: Type.Literal("send"), ...Change, workerId: Type.String({ minLength: 1 }), message: Type.String({ minLength: 1 }), delivery: Type.Optional(Type.Union([Type.Literal("reject"), Type.Literal("followUp")])), wait: Type.Optional(Type.Boolean()), timeoutMs: Type.Optional(Type.Number({ minimum: 1 })) }),
  steer: strict({ action: Type.Literal("steer"), ...Change, workerId: Type.String({ minLength: 1 }), message: Type.String({ minLength: 1 }), wait: Type.Optional(Type.Boolean()), timeoutMs: Type.Optional(Type.Number({ minimum: 1 })) }),
  status: strict({ action: Type.Literal("status"), ...Base, workerId: Type.String({ minLength: 1 }) }),
  list: strict({ action: Type.Literal("list"), ...Base }),
  read: strict({ action: Type.Literal("read"), ...Base, workerId: Type.String({ minLength: 1 }), afterCursor: Type.Optional(Type.Number({ minimum: 0 })), includeDetails: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })) }),
  abort: strict({ action: Type.Literal("abort"), ...Base, workerId: Type.String({ minLength: 1 }) }),
  destroy: strict({ action: Type.Literal("destroy"), ...Base, workerId: Type.String({ minLength: 1 }), force: Type.Optional(Type.Boolean()) }),
  doctor: strict({ action: Type.Literal("doctor"), ...Base }),
  report_terminal: strict({ action: Type.Literal("report_terminal"), ...Change, runId: Type.String({ minLength: 1 }), status: Type.Union([Type.Literal("completed"), Type.Literal("blocked_needs_human"), Type.Literal("failed"), Type.Literal("canceled")]), summary: Type.String({ minLength: 1, maxLength: 500 }), e2e: Type.Optional(Type.Array(Evidence, { minItems: 1, maxItems: 8 })), e2eWaiver: Type.Optional(Waiver), evidenceRefs: Type.Optional(Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 20 })) }),
} as const;

export const horsepowerSubagentSchema = Type.Union(Object.values(horsepowerActionSchemas));
