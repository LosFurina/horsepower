export interface SettlementDeliveryContext { cwd: string; isIdle(): boolean; hasPendingMessages(): boolean; sendMessage(message: { customType: string; content: string; display: boolean; details: Record<string, unknown> }, options: { deliverAs: "followUp"; triggerTurn: true }): void }
export interface SettlementNotice { workerId: string; status: "completed" | "failed" | "canceled"; messageId?: string; elapsedMs: number; lastProgressAgeMs: number; campaignId?: string }
export function deliverSettlementNotice(context: SettlementDeliveryContext, notice: SettlementNotice, expected: { cwd: string; generation: number }, current: () => { cwd: string; generation: number } | undefined): boolean {
  const owner = current();
  if (!owner || owner.cwd !== expected.cwd || owner.generation !== expected.generation || context.cwd !== expected.cwd) return false;
  if (!context.isIdle() || context.hasPendingMessages()) return false;
  const identity = { workerId: notice.workerId, ...(notice.messageId ? { messageId: notice.messageId } : {}), ...(notice.campaignId ? { campaignId: notice.campaignId } : {}) };
  context.sendMessage({ customType: "horsepower-worker-settlement", display: false, content: `Persistent worker ${notice.workerId} ${notice.status}. Inspect status/read for bounded details.`, details: { ...identity, status: notice.status, elapsedMs: Math.max(0, notice.elapsedMs), lastProgressAgeMs: Math.max(0, notice.lastProgressAgeMs) } }, { deliverAs: "followUp", triggerTurn: true });
  return true;
}
