import { type Address, formatUnits, maxUint256, zeroAddress } from "viem"
import { type DecodedCall, decodeCall } from "./decode"
import type { Intent, Token } from "./intent"
import type { PreparedOperation } from "./operation"
import { revertReason } from "./reason"
import { contractName, sameAddress } from "./registry"
import { formatAmount } from "./units"

export type Status = "pass" | "check" | "stop" | "note"
export type Finding = {
  id: string
  status: Status
  title: string
  detail?: string
  // Index of the prepared call this is about.
  call?: number
  // The call argument it clears or flags ("amount", "spender", "assets", "referralFee"…), when it is
  // about one argument rather than the whole call.
  arg?: string
}
export type Verdict = "PASS" | "CHECK" | "STOP"

export const verdict = (fs: Finding[]): Verdict =>
  fs.some((f) => f.status === "stop")
    ? "STOP"
    : fs.some((f) => f.status === "check")
      ? "CHECK"
      : "PASS"

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
// "supply_collateral_and_borrow" → "supply collateral and borrow"
const words = (operation: string) => operation.replace(/_/g, " ")

const fmt = (amount: bigint, t?: Token) =>
  t ? formatAmount(amount, t) : amount.toString()

// Bundle argument → the intent move it has to equal.
// "first" = the request's own amount, whichever way it moves (vault deposit or withdraw, supply,
// repay); the others name the market token whose move it has to equal.
const AMOUNT_ARGS: Record<string, "first" | "loanToken" | "collateralToken"> = {
  assets: "first",
  withdrawAssets: "first",
  repayAssets: "first",
  collateralAssets: "collateralToken",
  borrowAssets: "loanToken",
}

// The calls each modelled operation is allowed to contain: approvals of the tokens the user sends,
// to the one bundle contract it needs, an optional Morpho Blue authorization of that bundle, and
// exactly one bundle call. Anything else is STOP; an operation without a plan is CHECK.
type Plan = { contract: string; fn: string; authorize: boolean }
const PLANS: Record<string, Plan> = {
  deposit: {
    contract: "vaultBundlesV1",
    fn: "vaultBundlesV1Deposit",
    authorize: false,
  },
  supply_collateral_and_borrow: {
    contract: "blueBundlesV1",
    fn: "blueBundlesV1SupplyCollateralAndBorrow",
    authorize: true,
  },
}
export const planFor = (operation: string): Plan | undefined => PLANS[operation]

// Signed permits and authorizations inside a bundle. We don't read their payloads yet, so any
// non-empty one is CHECK.
function signedExtras(args: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const [name, v] of Object.entries(args)) {
    if (typeof v !== "object" || v === null) continue
    const o = v as Record<string, unknown>
    if ("kind" in o && "data" in o && (o.kind !== 0 || o.data !== "0x"))
      out.push(name)
    const sig = o.signature as { v?: number } | undefined
    if (sig && sig.v !== 0) out.push(name)
    if ("value" in o && typeof o.value === "bigint" && o.value !== 0n)
      out.push(name)
  }
  return out
}

function intentToken(intent: Intent, address: Address) {
  return intent.tokens.find((t) => sameAddress(t.address, address))
}

function who(chainId: number, a: Address) {
  const name = contractName(chainId, a)
  return name ? `${name} (${short(a)})` : short(a)
}

// Numbers written in the server's description ("Deposit 100 USDC", "spend 100000000 of …").
const numbersIn = (s: string) =>
  (s.replace(/0x[0-9a-fA-F]+…?/g, "").match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(
    // "1,000.50" → "1000.5", the form formatUnits gives.
    (n) =>
      n
        .replace(/,/g, "")
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, ""),
  )

function checkCall(
  i: number,
  d: DecodedCall,
  description: string,
  intent: Intent,
  plan: Plan | undefined,
  now: number,
): Finding[] {
  const out: Finding[] = []
  const c = intent.chainId
  const planned = (a: Address) =>
    plan === undefined || contractName(c, a) === plan.contract
  const f = (
    status: Status,
    id: string,
    title: string,
    detail?: string,
    arg?: string,
  ) => out.push({ id, status, title, detail, call: i, arg })

  switch (d.kind) {
    case "approve": {
      const token = intentToken(intent, d.token)
      const spender = contractName(c, d.spender)
      const sent = intent.moves.find(
        (m) => m.direction === "out" && sameAddress(m.token.address, d.token),
      )
      if (!sent && d.amount !== 0n && intent.resolved)
        f(
          "stop",
          "approve-token",
          `Approves ${token?.symbol ?? short(d.token)}, a token this request doesn't send`,
        )
      if (!spender) {
        f(
          "stop",
          "approve-spender",
          `Approves ${short(d.spender)}, which is not a Morpho contract`,
          `Spender ${d.spender} is not in Morpho's published deployments for chain ${c}.`,
          "spender",
        )
        break
      }
      if (!planned(d.spender)) {
        f(
          "stop",
          "approve-spender",
          `Approves ${spender}, which this ${words(intent.operation)} doesn't use`,
          `A ${words(intent.operation)} goes through ${plan?.contract}; this approval stays open afterwards.`,
          "spender",
        )
        break
      }
      const need = sent?.amount
      if (d.amount === 0n)
        f(
          "pass",
          "approve-amount",
          `Resets the ${token?.symbol ?? "token"} approval to 0`,
          undefined,
          "amount",
        )
      else if (d.amount === maxUint256)
        f(
          "check",
          "approve-amount",
          `Unlimited ${token?.symbol ?? "token"} approval to ${spender}`,
          need === undefined
            ? "The approval stays open after this transaction."
            : `${fmt(need, token)} would be enough; the approval stays open after this transaction.`,
          "amount",
        )
      else if (need === undefined)
        f(
          "check",
          "approve-amount",
          `Approves ${fmt(d.amount, token)} to ${spender}`,
          "The request has no fixed amount to compare with.",
          "amount",
        )
      else if (d.amount > need)
        f(
          "check",
          "approve-amount",
          `Approves ${fmt(d.amount, token)} to ${spender}, more than the ${fmt(need, token)} needed`,
          undefined,
          "amount",
        )
      else
        f(
          "pass",
          "approve-amount",
          `Approves exactly ${fmt(d.amount, token)} to ${spender}`,
          undefined,
          "amount",
        )
      const nums = numbersIn(description)
      if (
        nums.length > 0 &&
        !nums.includes(d.amount.toString()) &&
        d.amount !== maxUint256
      )
        f(
          "stop",
          "description",
          "The call's description doesn't match its calldata",
          `Description: “${description}”. Calldata approves ${d.amount}.`,
        )
      break
    }
    case "transfer": {
      const token = intentToken(intent, d.token)
      f(
        "stop",
        "transfer",
        `Sends ${fmt(d.amount, token)} straight to ${who(c, d.to)}`,
        "A prepared Morpho operation moves funds through Morpho's contracts, never with a direct transfer.",
      )
      break
    }
    case "authorize": {
      const isBlue = contractName(c, d.target) === "Morpho Blue"
      const authorized = contractName(c, d.authorized)
      const name = authorized ?? short(d.authorized)
      if (!isBlue)
        f(
          "stop",
          "authorize",
          `setAuthorization on ${short(d.target)}, which is not Morpho Blue`,
          undefined,
          "authorized",
        )
      else if (d.on && !authorized)
        f(
          "stop",
          "authorize",
          `Lets ${short(d.authorized)} manage your Morpho positions`,
          "It is not a Morpho contract.",
          "authorized",
        )
      else if (plan && (!plan.authorize || !planned(d.authorized) || !d.on))
        f(
          d.on ? "stop" : "check",
          "authorize",
          d.on
            ? `Lets ${authorized} manage your Morpho positions, which this ${words(intent.operation)} doesn't need`
            : `Revokes ${name}, which this ${words(intent.operation)} doesn't need`,
          undefined,
          "authorized",
        )
      else
        f(
          "pass",
          "authorize",
          d.on
            ? `Lets ${authorized} manage your Morpho positions`
            : `Revokes ${name}`,
          d.on
            ? "Needed so the bundle can borrow for you; it stays authorized afterwards."
            : undefined,
          "authorized",
        )
      break
    }
    case "bundle": {
      const target = contractName(c, d.target)
      const contract = d.fn.match(
        /^(vaultBundlesV1|blueBundlesV1|vaultExitBundlesV1)/,
      )?.[1]
      if (!target)
        f(
          "stop",
          "target",
          `Calls ${short(d.target)}, which is not a Morpho contract`,
        )
      else if (contract && target !== contract)
        f("stop", "target", `${d.fn} sent to ${target}, not to ${contract}`)
      else
        f(
          "pass",
          "target",
          `Calls ${target}.${d.fn.slice(contract?.length ?? 0).replace(/^./, (s) => s.toLowerCase())}`,
        )

      if (intent.vault && d.vault && !sameAddress(intent.vault, d.vault))
        f(
          "stop",
          "vault",
          `Uses vault ${short(d.vault)}, not ${short(intent.vault)}`,
          undefined,
          "vault",
        )
      else if (intent.vault && d.vault)
        f(
          "pass",
          "vault",
          `Vault ${short(d.vault)}, as requested`,
          undefined,
          "vault",
        )
      if (
        intent.marketId &&
        d.marketId &&
        intent.marketId.toLowerCase() !== d.marketId.toLowerCase()
      )
        f(
          "stop",
          "market",
          `Uses market ${short(d.marketId)}, not ${short(intent.marketId)}`,
          undefined,
          "market",
        )
      else if (intent.marketId && d.marketId)
        f(
          "pass",
          "market",
          `Market ${short(d.marketId)}, as requested`,
          undefined,
          "market",
        )

      for (const [arg, rule] of Object.entries(AMOUNT_ARGS)) {
        const v = d.args[arg]
        if (typeof v !== "bigint") continue
        const tokenAddr = rule === "first" ? undefined : d.market?.[rule]
        // "first" is the request's own amount, which resolveIntent always puts first; a "max"
        // amount stays unfixed here (CHECK already).
        const move =
          tokenAddr === undefined
            ? intent.moves[0]
            : intent.moves.find((m) => sameAddress(m.token.address, tokenAddr))
        if (move === undefined && !intent.resolved) continue
        if (move === undefined) {
          if (v !== 0n)
            f(
              "stop",
              "amount",
              `Also ${arg === "borrowAssets" ? "borrows" : "moves"} ${fmt(v, intentToken(intent, tokenAddr ?? zeroAddress))}, which you didn't ask for`,
              `${arg} = ${v}`,
              arg,
            )
          continue
        }
        if (move.amount === undefined) continue
        if (v === move.amount)
          f(
            "pass",
            "amount",
            `${move.direction === "out" ? "Moves" : "Receives"} ${fmt(v, move.token)}, as requested`,
            undefined,
            arg,
          )
        else
          f(
            "stop",
            "amount",
            `${arg} is ${fmt(v, move.token)}; you asked for ${fmt(move.amount, move.token)}`,
            undefined,
            arg,
          )
      }

      for (const name of signedExtras(d.args))
        f(
          "check",
          "permit",
          `Carries a signed ${name} that we don't read yet`,
          "Check what it allows in your wallet before signing.",
        )
      const realloc = d.args.reallocations
      if (Array.isArray(realloc) && realloc.length > 0)
        f(
          "check",
          "reallocation",
          `Moves liquidity between vaults first (${realloc.length} reallocation${realloc.length > 1 ? "s" : ""})`,
          "Public reallocations can charge a fee; we don't check them yet.",
        )

      const deadline = d.args.deadline
      if (typeof deadline === "bigint") {
        const left = Number(deadline) - now
        if (left < 0)
          f(
            "stop",
            "deadline",
            "The deadline has passed",
            "The bundle would revert; ask for a fresh one.",
            "deadline",
          )
        else if (left > 86_400)
          f(
            "check",
            "deadline",
            `The deadline is ${deadline >= 2n ** 64n ? "unlimited" : `${Math.round(left / 86_400)} days away`}`,
            "A signed bundle stays usable until then.",
            "deadline",
          )
        else
          f(
            "pass",
            "deadline",
            `Valid for ${Math.max(1, Math.round(left / 60))} more minutes`,
            undefined,
            "deadline",
          )
      }
      const maxLtv = d.args.maxLtv
      if (typeof maxLtv === "bigint" && d.market) {
        const pctOf = (v: bigint) =>
          formatUnits(v * 100n, 18).replace(/(\.\d)\d+$/, "$1")
        if (maxLtv < d.market.lltv)
          f(
            "pass",
            "max-ltv",
            `Reverts above ${pctOf(maxLtv)}% loan-to-value`,
            `The market liquidates at ${pctOf(d.market.lltv)}%.`,
          )
        else
          f(
            "check",
            "max-ltv",
            `Allows up to ${pctOf(maxLtv)}% loan-to-value`,
            `That is at or past the market's liquidation threshold of ${pctOf(d.market.lltv)}%.`,
          )
      }

      const pct = d.referralFeePct ?? 0n
      const recipient = d.referralFeeRecipient ?? zeroAddress
      if (pct > 0n && recipient !== zeroAddress)
        f(
          "stop",
          "fee",
          `Sends a ${formatUnits(pct * 100n, 18)}% referral fee to ${short(recipient)}`,
          "The request didn't ask for a referral fee.",
          "referralFee",
        )
      else f("pass", "fee", "No referral fee", undefined, "referralFee")

      const nums = numbersIn(description)
      const human = intent.moves.flatMap((m) =>
        m.amount === undefined ? [] : [formatUnits(m.amount, m.token.decimals)],
      )
      if (
        nums.length > 0 &&
        human.length > 0 &&
        !nums.some((n) => human.includes(n))
      )
        f(
          "stop",
          "description",
          "The call's description doesn't match its calldata",
          `Description: “${description}”. Requested: ${human.join(", ")}.`,
        )
      break
    }
    case "unknown":
      if (contractName(c, d.target))
        f(
          "check",
          "decoded",
          `Couldn't decode ${d.selector} on ${who(c, d.target)}`,
        )
      else
        f(
          "stop",
          "target",
          `Calls ${short(d.target)} (${d.selector}), which is not a Morpho contract`,
        )
      break
  }
  return out
}

// Checks that need nothing but the prepared operation and the intent.
export function staticChecks(
  intent: Intent,
  op: PreparedOperation,
  // Unix seconds, for the bundle's deadline.
  now = Math.floor(Date.now() / 1000),
): Finding[] {
  const out: Finding[] = []
  const wrongChain = op.transactions.findIndex(
    (t) => Number(t.chainId) !== intent.chainId,
  )
  out.push(
    wrongChain >= 0
      ? {
          id: "chain",
          status: "stop",
          title: `Call ${wrongChain + 1} is for chain ${op.transactions[wrongChain]?.chainId}, not ${intent.chainId}`,
          call: wrongChain,
        }
      : {
          id: "chain",
          status: "pass",
          title: `Every call is for chain ${intent.chainId}`,
        },
  )
  const plan = intent.modelled ? planFor(intent.operation) : undefined
  if (!plan)
    out.push({
      id: "intent",
      status: "check",
      title: `${words(intent.operation)} isn't modelled yet, so only Morpho's contract list is checked`,
    })
  for (const p of intent.problems)
    out.push({ id: "intent", status: "check", title: p })

  const decoded = op.transactions.map((tx) => decodeCall(tx))
  const bundles = decoded.flatMap((d, i) =>
    d.kind === "bundle" ? [{ fn: d.fn, i }] : [],
  )
  if (plan) {
    const one = bundles.length === 1 && bundles[0]?.fn === plan.fn
    out.push(
      one
        ? {
            id: "plan",
            status: "pass",
            title: `One ${plan.contract} call, as a ${words(intent.operation)} needs`,
          }
        : {
            id: "plan",
            status: "stop",
            title: `Expected one ${plan.fn}, found ${bundles.length === 0 ? "none" : bundles.map((b) => b.fn).join(", ")}`,
          },
    )
  }
  const approvals = new Map<string, number>()
  for (const d of decoded)
    if (d.kind === "approve" && d.amount !== 0n) {
      const k = `${d.token}-${d.spender}`.toLowerCase()
      approvals.set(k, (approvals.get(k) ?? 0) + 1)
    }
  if ([...approvals.values()].some((n) => n > 1))
    out.push({
      id: "approve-amount",
      status: "check",
      title: "Approves the same spender more than once",
    })

  // Approvals and authorizations prepare the bundle; one placed after it outlives it.
  const firstBundle = bundles[0]?.i ?? Number.POSITIVE_INFINITY
  decoded.forEach((d, i) => {
    const grants =
      (d.kind === "approve" && d.amount !== 0n) ||
      (d.kind === "authorize" && d.on)
    if (grants && i > firstBundle)
      out.push({
        id: "order",
        status: "stop",
        title: `Call ${i + 1} grants a permission after the bundle has run`,
        detail: "It isn't needed for this operation and stays open afterwards.",
        call: i,
      })
  })

  op.transactions.forEach((tx, i) => {
    const d = decoded[i]
    if (d) out.push(...checkCall(i, d, tx.description, intent, plan, now))
    const value = /^\d+$/.test(tx.value) ? BigInt(tx.value) : undefined
    if (value === undefined)
      out.push({
        id: "value",
        status: "stop",
        title: `Call ${i + 1} has an unreadable ETH value`,
        detail: tx.value,
        call: i,
      })
    else if (value !== 0n)
      out.push({
        id: "value",
        status: "stop",
        title: `Call ${i + 1} sends ${formatUnits(value, 18)} ETH`,
        call: i,
      })
  })

  for (const w of op.warnings)
    out.push({
      id: "server-warning",
      status: w.level === "error" ? "stop" : "note",
      title:
        w.level === "error"
          ? "Morpho's server reports an error"
          : "Morpho's server says",
      detail: revertReason(w.message),
    })
  return out
}
