import { z } from "zod";
import { monthSchema } from "./finance.js";

export const userContextEntrySchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),
  scope: z.enum(["general", "spending", "purchase", "investment"]),
  text: z.string().trim().min(1).max(500),
  month: z.union([monthSchema, z.literal("always")]),
  rule: z.enum(["none", "avoid_loss_sale", "avoid_loss_full_sale"]),
}).strict();
export const memoryUpdatesSchema = z.array(userContextEntrySchema.extend({ remove: z.boolean() })).max(12);

export function applyMemoryUpdates(current, input) {
  const updates = memoryUpdatesSchema.parse(input);
  const entries = new Map(current.map((entry) => [entry.key, entry]));
  for (const { remove, ...entry } of updates) {
    if (entry.rule !== "none" && entry.scope !== "investment") throw Error("매도 제한은 투자 선호에만 저장할 수 있습니다.");
    if (remove) entries.delete(entry.key);
    else entries.set(entry.key, entry);
  }
  return z.array(userContextEntrySchema).max(30).parse([...entries.values()]);
}

export function lossSaleConflict(preferences, decision, holding) {
  if (decision.side !== "SELL") return null;
  const rules = preferences.filter((p) => p.scope === "investment" && p.rule !== "none");
  if (!rules.length) return null;
  const loss = Number.isFinite(holding?.averagePrice) && holding.averagePrice > 0 && Number.isFinite(holding?.lastPrice) ? holding.lastPrice < holding.averagePrice : Number.isFinite(holding?.profitRate) ? holding.profitRate < 0 : null;
  if (loss === false) return null;
  if (rules.some((p) => p.rule === "avoid_loss_sale") || decision.quantity >= (holding?.quantity || 0)) {
    return loss === null ? "손익을 확인하지 못해 저장된 손실 매도 제한에 따라 보류했습니다." : rules.some((p) => p.rule === "avoid_loss_sale") ? "손실 종목은 매도하지 않겠다는 조건에 따라 보류했습니다." : "손실 상태에서 전량 매도하지 않겠다는 조건에 따라 보류했습니다.";
  }
  return null;
}
