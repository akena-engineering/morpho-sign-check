import {
  type PreparedOperation,
  PreparedOperation as Schema,
} from "./operation"

type Block = { type: string; text?: string }
export type Payload =
  | { kind: "one"; index: number; op: PreparedOperation }
  | { kind: "none" }
  | { kind: "unreadable"; reason: string }

const asJson = (text: string): unknown => {
  try {
    return JSON.parse(text.trim())
  } catch {
    return undefined
  }
}
// Deep equality that ignores key order.
const sameJson = (a: unknown, b: unknown): boolean => {
  if (
    typeof a !== "object" ||
    a === null ||
    typeof b !== "object" ||
    b === null
  )
    return a === b
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return (
    ka.length === kb.length &&
    ka.every((k) =>
      sameJson(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    )
  )
}
const hasCalls = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && "transactions" in v

// The one prepared operation in an MCP tool result. Two different ones (in two text blocks, or in
// the text and structuredContent) are unreadable: we won't check one and forward the other.
export function findPayload(content: Block[], structured?: unknown): Payload {
  const found = content.flatMap((b, index) => {
    const v = b.type === "text" && b.text ? asJson(b.text) : undefined
    return hasCalls(v) ? [{ index, v }] : []
  })
  if (found.length === 0)
    return hasCalls(structured)
      ? {
          kind: "unreadable",
          reason: "the operation is only in structuredContent",
        }
      : { kind: "none" }
  if (found.length > 1)
    return {
      kind: "unreadable",
      reason: "the response holds more than one operation",
    }
  const [first] = found
  if (!first) return { kind: "none" }
  // Everything the checks read (calls, warnings, simulation, proof) must be the same in both.
  if (hasCalls(structured) && !sameJson(structured, first.v))
    return {
      kind: "unreadable",
      reason: "structuredContent and the text differ",
    }
  const parsed = Schema.safeParse(first.v)
  return parsed.success
    ? { kind: "one", index: first.index, op: parsed.data }
    : {
        kind: "unreadable",
        reason: "the operation doesn't have the expected shape",
      }
}
