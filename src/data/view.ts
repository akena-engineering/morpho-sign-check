import { formatUnits } from "viem"
import type { Report } from "../check"
import type { Finding, Status } from "../core/checks"
import {
  type CallView,
  describeCall,
  diffArgs,
  linkApprovals,
} from "../core/describe"
import { netFlows } from "../core/flows"
import type { Reader } from "../core/intent"
import type { PreparedOperation } from "../core/operation"
import { sameAddress } from "../core/registry"
import type { ArgView, Scenario } from "./scenarios"

// A checked operation → the page's view of it. Browser-safe: `pnpm scenarios` builds the examples
// with it in Node, and "Check your own" builds the user's check with it in the browser.
export type ViewInput = {
  id: string
  label: string
  // The request as the user typed it, with the terms the calls must carry out marked
  // "[100 USDC](asset)"; the ids are describe.ts's `Term`s.
  request: string
  tool: string
  server: string
  probedAt: string
  op: PreparedOperation
  report: Report
  read: Reader
  // The untouched operation when the demo changed `op`: changed arguments show what they were.
  original?: PreparedOperation
  // Calls Sign Check added for the simulation (never something the user pasted).
  added?: number[]
}

export async function scenarioView(v: ViewInput): Promise<Scenario> {
  const { op, report } = v
  return {
    id: v.id,
    label: v.label,
    request: v.request.replace(/\[([^\]]+)\]\([a-z]+\)/g, "$1"),
    requestParts: requestParts(v.request),
    tampered: v.original !== undefined,
    tool: v.tool,
    user: report.intent.user,
    chainId: report.intent.chainId,
    server: v.server,
    probedAt: v.probedAt,
    summary: op.summary,
    calls: readBack(
      await views(op, report, v.read, v.original),
      report.findings,
    ).map((c, i) => (v.added?.includes(i) ? { ...c, added: true } : c)),
    wallet: wallet(report),
    verdict: report.verdict,
    findings: report.findings,
  }
}

async function views(
  op: PreparedOperation,
  report: Report,
  read: Reader,
  original?: PreparedOperation,
): Promise<CallView[]> {
  const { chainId, vault } = report.intent
  const tokens = report.tokens
  const asset = vault ? await read.vaultAsset(chainId, vault) : undefined
  return linkApprovals(
    op.transactions.map((tx, i) => {
      const v = describeCall(tx, chainId, tokens, asset)
      const o = original?.transactions[i]
      return o ? diffArgs(v, describeCall(o, chainId, tokens, asset)) : v
    }),
  )
}

// "Deposit [100 USDC](asset) into …" → text runs, the marked ones tagged with their term.
export function requestParts(marked: string) {
  return marked
    .split(/(\[[^\]]+\]\([a-z]+\))/)
    .filter(Boolean)
    .map((p) => {
      const m = /^\[([^\]]+)\]\(([a-z]+)\)$/.exec(p)
      return m ? { text: m[1] ?? "", term: m[2] } : { text: p }
    })
}

// Each argument read back against the request: which term it carries out, or Morpho's plumbing, or
// something the request never asked for, with the status of the check that names it (call, arg).
// An argument no check names is "unchecked": it never shows as cleared.
const ARG_KEY: Record<string, string> = { "referral fee": "referralFee" }
const RANK: Record<Status, number> = { pass: 0, note: 0, check: 1, stop: 2 }
function readBack(calls: CallView[], findings: Finding[]): Scenario["calls"] {
  return calls.map((c, i) => ({
    ...c,
    args: c.args.map(({ answers, ...a }) => {
      const key = ARG_KEY[a.name] ?? a.name
      const f = findings
        .filter((f) => f.call === i && f.arg === key)
        .sort((x, y) => RANK[y.status] - RANK[x.status])[0]
      const status: ArgView["status"] = !f
        ? "unchecked"
        : f.status === "note"
          ? "pass"
          : f.status
      return {
        ...a,
        link: answers ?? (status === "stop" ? "unasked" : "plumbing"),
        status,
        note: f && (status !== "pass" || !answers) ? f.title : undefined,
        detail: status === "stop" || status === "check" ? f?.detail : undefined,
      }
    }),
  }))
}

// "−100", "+87.18": the wallet's net change, at most 2 decimals.
function signed(v: bigint, decimals: number) {
  const [whole = "0", frac = ""] = formatUnits(v < 0n ? -v : v, decimals).split(
    ".",
  )
  const cut = frac.slice(0, 2).replace(/0+$/, "")
  return `${v < 0n ? "−" : "+"}${BigInt(whole).toLocaleString("en-US")}${cut ? `.${cut}` : ""}`
}

// The user's token changes in our own simulation, or why there are none to show.
function wallet(report: Report): Scenario["wallet"] {
  const { sim } = report
  if (sim.kind !== "ok") return { sim: sim.kind, changes: [], note: sim.reason }
  const server = report.findings.find(
    (f) => f.id === "sim-server" && f.status !== "pass",
  )
  const changes = [...netFlows(sim.transfers, report.intent.user)]
    .filter(([, v]) => v !== 0n)
    .sort(([, a], [, b]) => (a < b ? -1 : 1))
    .map(([addr, v]) => {
      const t = report.tokens.find((t) => sameAddress(t.address, addr))
      return {
        symbol: t?.symbol ?? addr,
        amount: t ? signed(v, t.decimals) : v.toString(),
        direction: v < 0n ? ("out" as const) : ("in" as const),
      }
    })
  return {
    sim: sim.kind,
    changes,
    note: server
      ? [server.title, server.detail].filter(Boolean).join(": ")
      : undefined,
  }
}
