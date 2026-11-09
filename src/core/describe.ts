import { type Address, formatUnits } from "viem"
import { short } from "./checks"
import { decodeCall } from "./decode"
import type { Token } from "./intent"
import type { PreparedTx } from "./operation"
import { contractName, sameAddress } from "./registry"
import { formatAmount } from "./units"

// A prepared call in words, for the page: what it calls and the arguments that decide where money
// goes. `changed` holds the original value when a demo scenario altered it. `answers` names the part
// of the request an argument carries out; arguments without it are Morpho's plumbing (spenders,
// deadlines) or something nobody asked for.
export type Term = "asset" | "collateral" | "loan" | "vault" | "market"
export type Arg = {
  name: string
  value: string
  changed?: string
  answers?: Term
}
export type CallView = {
  target: string
  fn: string
  description: string
  args: Arg[]
}

const AMOUNTS: Record<string, "loan" | "collateral" | "asset"> = {
  assets: "asset",
  collateralAssets: "collateral",
  borrowAssets: "loan",
  withdrawAssets: "asset",
  repayAssets: "loan",
}

export function describeCall(
  tx: PreparedTx,
  chainId: number,
  tokens: Token[],
  vaultAsset?: Address,
): CallView {
  const tokenOf = (a?: string) => tokens.find((t) => sameAddress(t.address, a))
  const who = (a: Address) => {
    const n = contractName(chainId, a)
    return n ? `${n} ${short(a)}` : short(a)
  }
  // "1,000 USDC": grouped like the request and the wallet ledger, so both sides of a link read alike.
  const amount = (v: bigint, t?: Token) =>
    t
      ? formatAmount(v, t).replace(/^\d+/, (d) =>
          BigInt(d).toLocaleString("en-US"),
        )
      : v.toString()
  const d = decodeCall(tx)
  const base = { description: tx.description }
  switch (d.kind) {
    case "approve":
      return {
        ...base,
        target: tokenOf(d.token)?.symbol ?? short(d.token),
        fn: "approve",
        args: [
          { name: "spender", value: who(d.spender) },
          {
            name: "amount",
            value:
              d.amount === 2n ** 256n - 1n
                ? "unlimited"
                : amount(d.amount, tokenOf(d.token)),
          },
        ],
      }
    case "transfer":
      return {
        ...base,
        target: tokenOf(d.token)?.symbol ?? short(d.token),
        fn: "transfer",
        args: [
          { name: "to", value: who(d.to) },
          { name: "amount", value: amount(d.amount, tokenOf(d.token)) },
        ],
      }
    case "authorize":
      return {
        ...base,
        target: contractName(chainId, d.target) ?? short(d.target),
        fn: "setAuthorization",
        args: [
          { name: "authorized", value: who(d.authorized) },
          { name: "allowed", value: String(d.on) },
        ],
      }
    case "unknown":
      return { ...base, target: who(d.target), fn: d.selector, args: [] }
    case "bundle": {
      const args: Arg[] = []
      if (d.vault)
        args.push({
          name: "vault",
          value: [tokenOf(d.vault)?.symbol, short(d.vault)].join(" ").trim(),
          answers: "vault",
        })
      if (d.market)
        args.push({
          name: "market",
          answers: "market",
          value: `${tokenOf(d.market.collateralToken)?.symbol ?? short(d.market.collateralToken)} / ${tokenOf(d.market.loanToken)?.symbol ?? short(d.market.loanToken)}`,
        })
      for (const [name, which] of Object.entries(AMOUNTS)) {
        const v = d.args[name]
        if (typeof v !== "bigint") continue
        const t =
          which === "asset"
            ? tokenOf(vaultAsset ?? d.market?.loanToken)
            : tokenOf(
                which === "loan"
                  ? d.market?.loanToken
                  : d.market?.collateralToken,
              )
        args.push({ name, value: amount(v, t), answers: which })
      }
      const pct = d.referralFeePct ?? 0n
      args.push({
        name: "referral fee",
        value:
          pct === 0n
            ? "none"
            : `${formatUnits(pct * 100n, 18)}% to ${short(d.referralFeeRecipient ?? "0x")}`,
      })
      const deadline = d.args.deadline
      if (typeof deadline === "bigint" && deadline < 2n ** 53n)
        args.push({
          name: "deadline",
          value: `${new Date(Number(deadline) * 1000).toISOString().slice(11, 16)} UTC`,
        })
      return {
        ...base,
        target: contractName(chainId, d.target) ?? short(d.target),
        fn: d.fn
          .replace(/^(vault|blue|vaultExit)BundlesV1/, "")
          .replace(/^./, (s) => s.toLowerCase()),
        args,
      }
    }
  }
}

// Marks the arguments that differ from the original call.
export function diffArgs(view: CallView, original: CallView): CallView {
  return {
    ...view,
    args: view.args.map((a) => {
      const before = original.args.find((o) => o.name === a.name)?.value
      return before !== undefined && before !== a.value
        ? { ...a, changed: before }
        : a
    }),
  }
}

// An approval answers the same part of the request as the bundle amount it pays for: the token the
// bundle pulls from the wallet (the deposit's asset, the collateral).
export function linkApprovals(views: CallView[]): CallView[] {
  const spent = views.flatMap((v) =>
    v.args.filter((a) => a.answers === "asset" || a.answers === "collateral"),
  )
  return views.map((v) =>
    v.fn !== "approve"
      ? v
      : {
          ...v,
          args: v.args.map((a) =>
            a.name === "amount"
              ? {
                  ...a,
                  answers: spent.find((s) => s.value.endsWith(` ${v.target}`))
                    ?.answers,
                }
              : a,
          ),
        },
  )
}
