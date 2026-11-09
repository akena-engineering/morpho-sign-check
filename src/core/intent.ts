import { type Address, type Hex, parseUnits } from "viem"
import type { MarketParams } from "./decode"
import { CHAIN_IDS } from "./operation"

// What the user asked for, in base units, built from the prepare tool's own arguments and onchain
// reads. Never from the server's response.
export type Token = { address: Address; symbol: string; decimals: number }
export type Move = {
  token: Token
  direction: "out" | "in"
  // Undefined when the user asked for "max" or the amount isn't fixed (shares received).
  amount?: bigint
}
export type Intent = {
  tool: string
  operation: string
  chainId: number
  user: Address
  vault?: Address
  marketId?: Hex
  moves: Move[]
  // False when this operation isn't modelled; checks that need the intent say so.
  modelled: boolean
  // Every token read for this request (vault asset and shares, market loan and collateral), so
  // amounts the request doesn't move can still be named.
  tokens: Token[]
  // False when the request's tokens couldn't be read; checks that compare with the request then
  // say CHECK instead of claiming a mismatch.
  resolved: boolean
  // Why an amount couldn't be fixed ("max", missing, more decimals than the token has).
  problems: string[]
}

export type Reader = {
  vaultAsset(chainId: number, vault: Address): Promise<Address>
  token(chainId: number, address: Address): Promise<Token>
  market(chainId: number, id: Hex): Promise<MarketParams>
}

export async function resolveIntent(
  tool: string,
  args: Record<string, unknown>,
  read: Reader,
): Promise<Intent> {
  const operation = tool.replace(/^morpho_prepare_/, "")
  const chainId = CHAIN_IDS[String(args.chain)] ?? 0
  const user = args.userAddress as Address
  const vault = args.vaultAddress as Address | undefined
  const marketId = args.marketId as Hex | undefined
  const problems: string[] = []
  const tokens: Token[] = []
  const base = {
    tool,
    operation,
    chainId,
    user,
    vault,
    marketId,
    problems,
    tokens,
    resolved: true,
  }
  // A fixed amount in base units, or undefined with the reason in `problems`.
  const amountOf = (v: unknown, t: Token, name = "amount") => {
    if (v === undefined || v === "") {
      problems.push(`The request has no ${name}, so it can't be compared`)
      return undefined
    }
    if (v === "max") {
      problems.push(
        `The request asks for "max" ${t.symbol}; we can't fix the exact amount`,
      )
      return undefined
    }
    const s = String(v)
    const decimals = s.split(".")[1]?.length ?? 0
    if (!/^\d+(\.\d+)?$/.test(s) || decimals > t.decimals) {
      problems.push(
        `The requested ${name} "${s}" isn't a valid ${t.symbol} amount (${t.decimals} decimals)`,
      )
      return undefined
    }
    return parseUnits(s, t.decimals)
  }

  if (vault && (operation === "deposit" || operation === "withdraw")) {
    const asset = await read.token(
      chainId,
      await read.vaultAsset(chainId, vault),
    )
    const shares = await read.token(chainId, vault)
    tokens.push(asset, shares)
    const assets: Move = {
      token: asset,
      direction: operation === "deposit" ? "out" : "in",
      amount: amountOf(args.amount, asset),
    }
    const shareMove: Move = {
      token: shares,
      direction: operation === "deposit" ? "in" : "out",
    }
    return { ...base, moves: [assets, shareMove], modelled: true }
  }

  if (marketId) {
    const m = await read.market(chainId, marketId)
    const loan = await read.token(chainId, m.loanToken)
    const coll = await read.token(chainId, m.collateralToken)
    tokens.push(loan, coll)
    const move = (
      direction: Move["direction"],
      t: Token,
      v: unknown,
    ): Move => ({
      token: t,
      direction,
      amount: amountOf(v, t),
    })
    // Built on demand: only the requested operation's amounts are read.
    const moves: Record<string, () => Move[]> = {
      supply: () => [move("out", loan, args.amount)],
      supply_collateral: () => [move("out", coll, args.amount)],
      borrow: () => [move("in", loan, args.borrowAmount)],
      repay: () => [move("out", loan, args.amount)],
      withdraw_collateral: () => [move("in", coll, args.amount)],
      supply_collateral_and_borrow: () => [
        move("out", coll, args.collateralAmount),
        move("in", loan, args.borrowAmount),
      ],
    }
    const build = moves[operation]
    if (build) return { ...base, moves: build(), modelled: true }
  }

  return { ...base, moves: [], modelled: false }
}
