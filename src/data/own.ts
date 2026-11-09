import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  parseAbi,
  parseUnits,
} from "viem"
import { z } from "zod"
import { chainReader, clientFor } from "../chain/client"
import { checkOperation, type Report } from "../check"
import { type Finding, planFor, short, verdict } from "../core/checks"
import { decodeCall } from "../core/decode"
import depositFixture from "../core/fixtures/eth-deposit-v1.json"
import type { Intent, Reader } from "../core/intent"
import {
  PreparedOperation as OperationSchema,
  type PreparedOperation,
} from "../core/operation"
import { findPayload } from "../core/payload"
import { contractName, morphoContracts } from "../core/registry"
import { argIndex, rewrite, tamper } from "../core/tamper"
import type { Scenario } from "./scenarios"
import { scenarioView } from "./view"

// "Check your own": the user's request (a form) and what they were asked to sign (pasted), checked
// in the browser with the same checks and the same view as the examples. Ethereum only, keyless
// public RPC (client.ts); nothing is signed or sent.

export const EXAMPLE_USER: Address =
  "0x6cBecB6916B3085690eD8BE0402239E53aB5E986"
export const EXAMPLE_VAULT: Address =
  "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB"
// wstETH / USDC, the borrow example's market.
export const EXAMPLE_MARKET: Hex =
  "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc"

// The launch video's hook: the deposit call as Morpho prepared it, and the same call with a 5%
// referral fee to a stranger (changed by Sign Check for the demo). Morpho's deadline runs out about
// two hours after probing, so both get it renewed to an hour from `now` (unix seconds) when filled
// in. Only these built-in examples are ever re-encoded; a paste never is.
const prepared = z
  .object({ result: OperationSchema })
  .parse(depositFixture).result
const BUNDLE_CALL = 1
export const EXAMPLE_TO = prepared.transactions[BUNDLE_CALL]?.to as Address
export function examples(now = Math.floor(Date.now() / 1000)) {
  const renewed = rewrite(prepared, BUNDLE_CALL, (args, fn) => {
    args[argIndex(fn, "deadline")] = BigInt(now + 3600)
    return args
  })
  const callOf = (op: PreparedOperation) =>
    op.transactions[BUNDLE_CALL]?.data ?? "0x"
  return { a: callOf(renewed), b: callOf(tamper(renewed, "fee")) }
}

const address = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, "isn't an address (0x and 40 hex characters)")
  .transform((a) => a as Address)
export const OwnRequest = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("deposit"),
    vault: address,
    amount: z.string().trim(),
    user: address,
  }),
  z.object({
    operation: z.literal("supply_collateral_and_borrow"),
    marketId: z
      .string()
      .trim()
      .regex(
        /^0x[0-9a-fA-F]{64}$/,
        "isn't a market id (0x and 64 hex characters)",
      )
      .transform((m) => m as Hex),
    collateralAmount: z.string().trim(),
    borrowAmount: z.string().trim(),
    user: address,
  }),
])
export type OwnRequest = z.input<typeof OwnRequest>
type Request = z.output<typeof OwnRequest>

export type OwnInput = {
  request: OwnRequest
  paste: string
  // Where raw calldata goes; empty = inferred from the function.
  to: string
  // Prepend the approval (and, for a borrow, the authorization) Morpho prepares with the bundle.
  addApproval: boolean
  // Example B only: the unchanged call (Example A), so the read-back shows what the demo changed.
  original?: Hex
}

// What was pasted: one call's calldata, a prepared operation, or a list of calls.
type Call = {
  to: Address
  data: Hex
  value?: string | number
  chainId?: string | number
}
export type Paste =
  | { kind: "hex"; data: Hex }
  | { kind: "op"; op: PreparedOperation }
  | { kind: "calls"; calls: Call[] }

export class InputError extends Error {}

const CallSchema = z.object({
  to: address,
  data: z
    .string()
    .regex(/^0x[0-9a-fA-F]*$/)
    .transform((d) => d as Hex),
  value: z.union([z.string(), z.number()]).optional(),
  // Kept so a call for another chain is flagged, not checked as Ethereum's.
  chainId: z.union([z.string(), z.number()]).optional(),
})
const Calls = z.union([CallSchema.transform((c) => [c]), z.array(CallSchema)])
const McpResult = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  structuredContent: z.unknown().optional(),
})
const ProbeFile = z.object({
  result: z.looseObject({ transactions: z.unknown() }),
})

export function readPaste(text: string): Paste {
  const t = text.trim()
  if (!t)
    throw new InputError("Paste what you're asked to sign, or pick an example.")
  if (/^0x/i.test(t)) {
    const data = t.replace(/\s+/g, "")
    if (!/^0x[0-9a-fA-F]*$/.test(data) || data.length % 2 !== 0)
      throw new InputError(
        "That isn't valid calldata: after 0x it needs an even number of hex characters (0-9, a-f).",
      )
    if (data.length < 10)
      throw new InputError(
        "That calldata is too short: a call starts with a 4-byte function selector (0x and 8 hex characters).",
      )
    return { kind: "hex", data: data as Hex }
  }
  let json: unknown
  try {
    json = JSON.parse(t)
  } catch {
    throw new InputError(
      "That isn't calldata or JSON. Paste 0x… calldata, the JSON a morpho_prepare_* tool returns, or a list of {to, data, value} calls.",
    )
  }
  // An MCP tool result, a saved probe ({tool, args, result}), or the operation itself.
  const mcp = McpResult.safeParse(json)
  const probe = ProbeFile.safeParse(json)
  const payload = mcp.success
    ? findPayload(mcp.data.content, mcp.data.structuredContent)
    : findPayload([
        {
          type: "text",
          text: JSON.stringify(probe.success ? probe.data.result : json),
        },
      ])
  if (payload.kind === "one") return { kind: "op", op: payload.op }
  if (payload.kind === "unreadable")
    throw new InputError(`That operation can't be read: ${payload.reason}.`)
  const calls = Calls.safeParse(json)
  if (calls.success && calls.data.length > 0)
    return { kind: "calls", calls: calls.data }
  throw new InputError(
    "That JSON isn't a prepared operation or a list of calls. Each call needs a `to` address and `data` hex.",
  )
}

const contract = (name: string) =>
  morphoContracts(1).find((c) => c.name === name)?.address
// The request's own bundle contract and whether it needs a Blue authorization, from the checker's plan.
const plan = (operation: Request["operation"]) => {
  const p = planFor(operation)
  if (!p) throw new Error(`No plan for ${operation}`)
  return p
}
const decodeData = (data: Hex) =>
  decodeCall(tx("0x0000000000000000000000000000000000000000", data))

// Where raw calldata goes when the user didn't say: the bundle contract its function belongs to, or
// the request's own bundle contract (the checks then say what they make of it).
function inferTo(
  d: ReturnType<typeof decodeCall>,
  operation: Request["operation"],
): Address {
  const name =
    (d.kind === "bundle"
      ? d.fn.match(/^(vaultBundlesV1|blueBundlesV1|vaultExitBundlesV1)/)?.[1]
      : undefined) ?? plan(operation).contract
  const a = contract(name)
  if (!a) throw new Error(`${name} isn't in Morpho's contract list`)
  return a
}

const tx = (
  to: Address,
  data: Hex,
  value: string | number = "0",
  chainId: string | number = "1",
) => ({
  to,
  data,
  value: String(value),
  chainId: String(chainId),
  description: "",
})

// The calls Morpho prepares before the bundle: approve the token the user sends to the bundle
// contract, for the requested amount, and for a borrow let the bundle act on the user's Blue position.
async function calls(r: Request, bundle: Address, read: Reader) {
  const token =
    r.operation === "deposit"
      ? await read.vaultAsset(1, r.vault)
      : (await read.market(1, r.marketId)).collateralToken
  const { decimals } = await read.token(1, token)
  const amount = r.operation === "deposit" ? r.amount : r.collateralAmount
  let units: bigint
  try {
    units = parseUnits(amount, decimals)
  } catch {
    throw new InputError(
      `Enter the amount as a number (like 100) so Sign Check can add the approval for it.`,
    )
  }
  const approve = tx(
    token,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [bundle, units],
    }),
  )
  if (!plan(r.operation).authorize) return [approve]
  const blue = contract("Morpho Blue")
  if (!blue) throw new Error("Morpho Blue isn't in Morpho's contract list")
  const authorize = tx(
    blue,
    encodeFunctionData({
      abi: parseAbi([
        "function setAuthorization(address authorized, bool newIsAuthorized)",
      ]),
      functionName: "setAuthorization",
      args: [bundle, true],
    }),
  )
  return [approve, authorize]
}

const asOperation = (
  operation: string,
  transactions: ReturnType<typeof tx>[],
): PreparedOperation =>
  OperationSchema.parse({ operation, chain: "ethereum", transactions })

// The request and the paste → what checkOperation takes. Throws InputError for anything the user
// can fix; RPC failures while adding the approval surface as InputError too, with the way out.
export async function prepare(input: OwnInput, read: Reader) {
  const parsed = OwnRequest.safeParse(input.request)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new InputError(
      `The ${LABELS[String(issue?.path[0])] ?? "request"} ${issue?.message ?? "isn't valid"}.`,
    )
  }
  const r = parsed.data
  const tool = `morpho_prepare_${r.operation}`
  const args =
    r.operation === "deposit"
      ? {
          chain: "ethereum",
          vaultAddress: r.vault,
          userAddress: r.user,
          amount: r.amount,
        }
      : {
          chain: "ethereum",
          marketId: r.marketId,
          userAddress: r.user,
          collateralAmount: r.collateralAmount,
          borrowAmount: r.borrowAmount,
        }
  const paste = readPaste(input.paste)
  if (paste.kind === "op")
    return { r, tool, args, op: paste.op, added: [], fromServer: true }
  if (paste.kind === "calls")
    return {
      r,
      tool,
      args,
      op: asOperation(
        r.operation,
        paste.calls.map((c) => tx(c.to, c.data, c.value, c.chainId)),
      ),
      added: [],
      fromServer: false,
    }

  const to = input.to.trim()
  if (to && !/^0x[0-9a-fA-F]{40}$/.test(to))
    throw new InputError(
      "The “sent to” address isn't an address (0x and 40 hex characters).",
    )
  const decoded = decodeData(paste.data)
  const target = to ? (to as Address) : inferTo(decoded, r.operation)
  let before: ReturnType<typeof tx>[] = []
  if (input.addApproval && decoded.kind === "bundle")
    try {
      before = await calls(r, target, read)
    } catch (e) {
      if (e instanceof InputError) throw e
      throw new InputError(
        `Couldn't read the token to approve from Ethereum (${message(e)}). Untick “Include the approval” to check the call alone.`,
      )
    }
  const build = (data: Hex) =>
    asOperation(r.operation, [...before, tx(target, data)])
  return {
    r,
    tool,
    args,
    op: build(paste.data),
    added: before.map((_, i) => i),
    fromServer: false,
    // Example B is changed by Sign Check: show what each changed argument was.
    original: input.original ? build(input.original) : undefined,
    // Where the call goes when the user didn't say: an assumption, never a pass.
    assumed: to ? undefined : { to: target, call: before.length },
  }
}

// A CHECK line of its own when Sign Check had to assume where raw calldata goes, added to the
// checker's findings and verdict.
export function withAssumedTarget(
  report: Report,
  assumed?: { to: Address; call: number },
): Report {
  if (!assumed) return report
  const name = contractName(1, assumed.to)
  const findings: Finding[] = [
    ...report.findings,
    {
      id: "target-assumed",
      status: "check",
      title: `You didn't say where this call goes; Sign Check assumed ${name ? `${name} ` : ""}${short(assumed.to)}. Check the address in your wallet.`,
      call: assumed.call,
    },
  ]
  return { ...report, findings, verdict: verdict(findings) }
}

const LABELS: Record<string, string> = {
  vault: "vault address",
  marketId: "market id",
  user: "wallet address",
}

const message = (e: unknown) =>
  e instanceof Error
    ? ((e as { shortMessage?: string }).shortMessage ?? e.message)
    : String(e)

// Runs every check in this browser and returns the page's view of it.
export async function checkOwn(input: OwnInput): Promise<Scenario> {
  const read = chainReader()
  const p = await prepare(input, read)
  const report = withAssumedTarget(
    await checkOperation(p.tool, p.args, p.op, {
      reader: read,
      // Only a pasted morpho_prepare_* result came from Morpho's server.
      fromServer: p.fromServer,
    }),
    "assumed" in p ? p.assumed : undefined,
  )
  return scenarioView({
    id: "own",
    label: "Your check",
    request: await requestText(p.r, report.intent),
    tool: p.tool,
    server: "your paste",
    probedAt: new Date().toISOString(),
    op: p.op,
    report,
    read,
    original: "original" in p ? p.original : undefined,
    added: p.added,
  })
}

// The request in words, its terms marked like the examples': "Deposit [100 USDC](asset) into
// [Steakhouse USDC](vault)."
async function requestText(r: Request, intent: Intent) {
  const sym = (i: number) => intent.tokens[i]?.symbol ?? ""
  const amt = (a: string, s: string) =>
    `${a.replace(/^\d+(?=(\.\d+)?$)/, (d) => BigInt(d).toLocaleString("en-US"))} ${s}`.trim()
  if (r.operation === "deposit") {
    const name = await clientFor(1)
      .readContract({ address: r.vault, abi: erc20Abi, functionName: "name" })
      .catch(() => sym(1) || `vault ${short(r.vault)}`)
    return `Deposit [${amt(r.amount, sym(0))}](asset) into [${name}](vault).`
  }
  const [loan, coll] = [sym(0), sym(1)]
  const market = loan && coll ? `${coll} / ${loan}` : short(r.marketId)
  return `Supply [${amt(r.collateralAmount, coll)}](collateral) and borrow [${amt(r.borrowAmount, loan)}](loan) on the [${market}](market) market.`
}
