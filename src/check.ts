import type { Address } from "viem"
import { chainReader, type Rpcs, redact } from "./chain/client"
import { simulate } from "./chain/simulate"
import {
  type Finding,
  staticChecks,
  type Verdict,
  verdict,
} from "./core/checks"
import { type SimResult, simChecks } from "./core/flows"
import {
  type Intent,
  type Reader,
  resolveIntent,
  type Token,
} from "./core/intent"
import { CHAIN_IDS, type PreparedOperation } from "./core/operation"
import { JWKS_URL, parseJwks, proofCheck } from "./core/proof"
import { sameAddress } from "./core/registry"

export type Report = {
  intent: Intent
  findings: Finding[]
  verdict: Verdict
  // Our own simulation, and every token it or Morpho's mentions, for showing the wallet's changes.
  sim: SimResult
  tokens: Token[]
}

// Every check on one prepared operation: the request's own arguments → intent (onchain reads),
// calldata checks, our own simulation, then the proof. A step that fails becomes a CHECK line of
// its own; it never hides what earlier steps found.
export async function checkOperation(
  tool: string,
  args: Record<string, unknown>,
  op: PreparedOperation,
  // fromServer: false when the calls were pasted rather than returned by Morpho's server.
  opts: {
    rpcs?: Rpcs
    reader?: Reader
    now?: number
    fromServer?: boolean
  } = {},
): Promise<Report> {
  const read = opts.reader ?? chainReader(opts.rpcs)
  const intent = await resolveIntent(tool, args, read).catch(
    (e: Error): Intent => ({
      tool,
      operation: tool.replace(/^morpho_prepare_/, ""),
      chainId: CHAIN_IDS[String(args.chain)] ?? 0,
      user: args.userAddress as Address,
      moves: [],
      tokens: [],
      resolved: false,
      modelled: false,
      problems: [
        `Couldn't read the request's tokens onchain: ${message(e, opts.rpcs)}`,
      ],
    }),
  )
  const findings = staticChecks(intent, op, opts.now)

  const sim = await simulate(op, intent.chainId, intent.user, opts.rpcs)
  // Every token either simulation mentions, so amounts in both can be read.
  const tokens: Token[] = intent.moves.map((m) => m.token)
  const addresses = [
    ...(sim.kind === "ok" ? sim.transfers.map((t) => t.token) : []),
    ...(op.simulation?.transfers ?? []).map((t) => t.token.address),
  ]
  for (const a of addresses)
    if (!tokens.some((k) => sameAddress(k.address, a))) {
      const t = await read.token(intent.chainId, a).catch(() => undefined)
      if (t) tokens.push(t)
    }
  try {
    findings.push(...simChecks(intent, op, sim, tokens, opts.fromServer))
  } catch (e) {
    findings.push({
      id: "sim",
      status: "check",
      title: "Couldn't compare the simulations",
      detail: message(e, opts.rpcs),
    })
  }

  if (op.action_proof === undefined)
    findings.push(await proofCheck(undefined, { keys: [] }))
  else
    try {
      findings.push(await proofCheck(op.action_proof, await morphoJwks()))
    } catch (e) {
      findings.push({
        id: "proof",
        status: "check",
        title: "Couldn't fetch Morpho's signing key",
        detail: message(e),
      })
    }
  return { intent, findings, verdict: verdict(findings), sim, tokens }
}

const message = (e: unknown, rpcs?: Rpcs) =>
  redact(e instanceof Error ? e.message : String(e), rpcs)

// Morpho's published signing keys, fetched once.
let jwks: ReturnType<typeof parseJwks> | undefined
async function morphoJwks() {
  jwks ??= parseJwks(await fetch(JWKS_URL).then((r) => r.json()))
  return jwks
}
