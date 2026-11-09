import {
  type Abi,
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  type Hex,
  keccak256,
  parseAbi,
} from "viem"
import blueBundles from "./abis/blueBundlesV1.json"
import vaultBundles from "./abis/vaultBundlesV1.json"
import vaultExitBundles from "./abis/vaultExitBundlesV1.json"
import type { PreparedTx } from "./operation"

const erc20 = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
])
const blue = parseAbi([
  "function setAuthorization(address authorized, bool newIsAuthorized)",
])

// Most specific first: a bundle selector never collides with an ERC-20 one.
const ABIS: { contract: string; abi: Abi }[] = [
  { contract: "vaultBundlesV1", abi: vaultBundles as Abi },
  { contract: "blueBundlesV1", abi: blueBundles as Abi },
  { contract: "vaultExitBundlesV1", abi: vaultExitBundles as Abi },
  { contract: "Morpho Blue", abi: blue },
  { contract: "ERC-20", abi: erc20 },
]

export type MarketParams = {
  loanToken: Address
  collateralToken: Address
  oracle: Address
  irm: Address
  lltv: bigint
}

export type DecodedCall =
  | { kind: "approve"; token: Address; spender: Address; amount: bigint }
  | { kind: "transfer"; token: Address; to: Address; amount: bigint }
  | { kind: "authorize"; target: Address; authorized: Address; on: boolean }
  | {
      kind: "bundle"
      target: Address
      fn: string
      args: Record<string, unknown>
      // Pulled out of the bundle args when present.
      vault?: Address
      marketId?: Hex
      market?: MarketParams
      referralFeePct?: bigint
      referralFeeRecipient?: Address
    }
  | { kind: "unknown"; target: Address; selector: Hex }

// Morpho Blue market id: keccak256(abi.encode(MarketParams)).
export const marketId = (m: MarketParams): Hex =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
      ],
      [m.loanToken, m.collateralToken, m.oracle, m.irm, m.lltv],
    ),
  )

function named(abi: Abi, fn: string, args: readonly unknown[]) {
  const item = abi.find((x) => x.type === "function" && x.name === fn)
  const out: Record<string, unknown> = {}
  if (item?.type !== "function") return out
  item.inputs.forEach((input, i) => {
    out[input.name ?? String(i)] = args[i]
  })
  return out
}

export function decodeCall(tx: PreparedTx): DecodedCall {
  for (const { abi } of ABIS) {
    let d: { functionName: string; args: readonly unknown[] | undefined }
    try {
      d = decodeFunctionData({ abi, data: tx.data })
    } catch {
      continue
    }
    const a = d.args ?? []
    switch (d.functionName) {
      case "approve":
        return {
          kind: "approve",
          token: tx.to,
          spender: a[0] as Address,
          amount: a[1] as bigint,
        }
      case "transfer":
        return {
          kind: "transfer",
          token: tx.to,
          to: a[0] as Address,
          amount: a[1] as bigint,
        }
      case "transferFrom":
        return {
          kind: "transfer",
          token: tx.to,
          to: a[1] as Address,
          amount: a[2] as bigint,
        }
      case "setAuthorization":
        return {
          kind: "authorize",
          target: tx.to,
          authorized: a[0] as Address,
          on: a[1] as boolean,
        }
    }
    const args = named(abi, d.functionName, a)
    const market = args.marketParams as MarketParams | undefined
    return {
      kind: "bundle",
      target: tx.to,
      fn: d.functionName,
      args,
      vault: (args.vault ?? args.sourceVault) as Address | undefined,
      market,
      marketId: market ? marketId(market) : undefined,
      referralFeePct: args.referralFeePct as bigint | undefined,
      referralFeeRecipient: args.referralFeeRecipient as Address | undefined,
    }
  }
  return {
    kind: "unknown",
    target: tx.to,
    selector: tx.data.slice(0, 10) as Hex,
  }
}
