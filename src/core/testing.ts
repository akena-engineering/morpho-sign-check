import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeCall } from "./decode"
import type { Reader, Token } from "./intent"
import { type PreparedTx, parseOperation } from "./operation"
import { sameAddress } from "./registry"

// Test helpers: real fixtures from `pnpm probe`, and onchain values read on 2026-11-05.
export const USDC: Token = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  decimals: 6,
}
export const WSTETH: Token = {
  address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  symbol: "wstETH",
  decimals: 18,
}
export const STEAK: Token = {
  address: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
  symbol: "steakUSDC",
  decimals: 18,
}
export const BASE_USDC: Token = {
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  symbol: "USDC",
  decimals: 6,
}

export const fakeReader: Reader = {
  vaultAsset: async (chainId) =>
    chainId === 8453 ? BASE_USDC.address : USDC.address,
  token: async (_c, a) =>
    [USDC, BASE_USDC, WSTETH, STEAK].find((t) => sameAddress(t.address, a)) ?? {
      address: a,
      symbol: "?",
      decimals: 18,
    },
  market: async () => {
    const op = fixture("eth-collateral-borrow").op
    const d = decodeCall(op.transactions[2] as PreparedTx)
    if (d.kind !== "bundle" || !d.market) throw new Error("fixture changed")
    return d.market
  },
}

export function fixture(name: string) {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"),
  )
  return {
    tool: raw.tool as string,
    args: raw.args as Record<string, unknown>,
    op: parseOperation(raw.result),
    // When the fixture was probed (unix seconds): "now" for its deadline.
    now: Math.floor(Date.parse(raw.probedAt) / 1000),
  }
}

export { rewrite as tamper, STRANGER } from "./tamper"
