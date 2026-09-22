import { createHash } from "node:crypto";
import { importSchema, dateSchema } from "./finance.js";
export function normalizeImport(input) {
  if (!input?.result) return importSchema.parse(input);
  if (input.result.code !== "CF-00000")
    throw Error("성공한 CODEF 응답만 가져올 수 있습니다.");
  const list = Array.isArray(input.data) ? input.data : [input.data];
  if (!list.length || list.length > 10000)
    throw Error("1~10000건 파일을 가져오세요.");
  const occurrence = new Map();
  const transactions = list.map((r) => {
    if (
      !r ||
      typeof r.resUsedDate !== "string" ||
      !/^\d{8}$/.test(r.resUsedDate) ||
      !/^\d+$/.test(String(r.resUsedAmount)) ||
      typeof r.resMemberStoreName !== "string" ||
      !["0", "1", "2", "3"].includes(r.resCancelYN)
    )
      throw Error("승인내역 파일 형식을 확인하세요.");
    const date = dateSchema.parse(
      r.resUsedDate.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
    );
    const signature = [
      date,
      r.resUsedTime || "",
      r.resMemberStoreName,
      r.resUsedAmount,
    ].join("|");
    const n = occurrence.get(signature) || 0;
    occurrence.set(signature, n + 1);
    return {
      id: createHash("sha256")
        .update(signature + "|" + n)
        .digest("hex"),
      date,
      merchant: r.resMemberStoreName,
      amount: Number(r.resUsedAmount),
      category: "other",
      status: { 0: "unpaid", 1: "cancelled", 2: "partial", 3: "rejected" }[
        r.resCancelYN
      ],
      source: "codef-file",
      evidence:
        "파일의 날짜·시각·가맹점·금액 기준 중복 처리. 승인 거래는 미납으로 반영.",
    };
  });
  const dates = transactions.map((t) => t.date).sort();
  return importSchema.parse({
    transactions,
    from: dates[0],
    to: dates.at(-1),
    complete: false,
    source: "codef-file",
  });
}
