import { z } from "zod"

// public/data/scenarios.json, written by `pnpm scenarios`.
// "unchecked": no check names this argument, so the page never shows it as cleared.
const Status = z.enum(["pass", "check", "stop", "unchecked"])
// One argument read back against the request: `link` is the request term it carries out
// ("asset", "vault"…), "plumbing" (Morpho's own machinery) or "unasked" (nobody asked for it).
const Arg = z.object({
  name: z.string(),
  value: z.string(),
  changed: z.string().optional(),
  link: z.string(),
  status: Status,
  note: z.string().optional(),
  detail: z.string().optional(),
})
const Finding = z.object({
  id: z.string(),
  status: z.enum(["pass", "check", "stop", "note"]),
  title: z.string(),
  detail: z.string().optional(),
  call: z.number().optional(),
})
export const Scenario = z.object({
  id: z.string(),
  label: z.string(),
  request: z.string(),
  requestParts: z.array(
    z.object({ text: z.string(), term: z.string().optional() }),
  ),
  tampered: z.boolean(),
  tool: z.string(),
  user: z.string(),
  chainId: z.number(),
  server: z.string(),
  probedAt: z.string(),
  summary: z.string(),
  calls: z.array(
    z.object({
      target: z.string(),
      fn: z.string(),
      description: z.string(),
      args: z.array(Arg),
      // Added by Sign Check so the simulation can run ("Check your own"); never pasted by the user.
      added: z.boolean().optional(),
    }),
  ),
  // The user's net token changes in our own simulation; when it reverted or couldn't run, `note`
  // holds the reason.
  wallet: z.object({
    sim: z.enum(["ok", "reverted", "unavailable"]),
    changes: z.array(
      z.object({
        symbol: z.string(),
        amount: z.string(),
        direction: z.enum(["in", "out"]),
      }),
    ),
    note: z.string().optional(),
  }),
  verdict: z.enum(["PASS", "CHECK", "STOP"]),
  findings: z.array(Finding),
})
export type Scenario = z.infer<typeof Scenario>
export type ArgView = z.infer<typeof Arg>
export type FindingView = z.infer<typeof Finding>

export const ScenarioFile = z.object({
  checkedAt: z.string(),
  block: z.number(),
  scenarios: z.array(Scenario),
})
export type ScenarioFile = z.infer<typeof ScenarioFile>

// Which part of the check a finding belongs to, for grouping on the page. `ok` is the group's one
// line when nothing in it needs attention.
export const GROUPS = [
  {
    id: "calls",
    title: "The calls",
    lead: "Each call decoded and compared with Morpho's contract list and your request.",
    ok: "No mismatch with your request or Morpho's contract list.",
  },
  {
    id: "money",
    title: "The money",
    lead: "Every call simulated in order from your wallet on our own Ethereum node.",
    ok: "Simulated token changes match your request.",
  },
  {
    id: "server",
    title: "Morpho's server",
    lead: "What the response itself says.",
    ok: "Nothing to flag in the response.",
  },
] as const
export type GroupId = (typeof GROUPS)[number]["id"]

export function groupOf(id: string): GroupId {
  if (id.startsWith("sim") || id === "price") return "money"
  if (id === "server-warning" || id === "proof") return "server"
  return "calls"
}
