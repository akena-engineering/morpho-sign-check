import {
  type Address,
  createPublicClient,
  erc20Abi,
  type Hex,
  http,
  type PublicClient,
  parseAbi,
} from "viem"
import { base, mainnet } from "viem/chains"
import type { Reader } from "../core/intent"
import { morphoContracts } from "../core/registry"

// Keyless public RPCs. Node callers may pass their own for Ethereum (ETH_RPC_URL, see env.ts).
export const PUBLIC_RPC: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  8453: "https://mainnet.base.org",
}
const CHAINS = { 1: mainnet, 8453: base } as const

export type Rpcs = Partial<Record<number, string>>

// RPC URLs often carry an API key, and viem's errors quote the URL: never echo one into a finding.
export const redact = (text: string, rpcs: Rpcs = {}) =>
  Object.values(rpcs).reduce<string>(
    (t, url) => (url ? t.replaceAll(url, "<your RPC>") : t),
    text,
  )

const clients = new Map<string, PublicClient>()
export function clientFor(chainId: number, rpcs: Rpcs = {}): PublicClient {
  const url = rpcs[chainId] ?? PUBLIC_RPC[chainId]
  const chain = CHAINS[chainId as keyof typeof CHAINS]
  if (!url || !chain) throw new Error(`No RPC for chain ${chainId}`)
  let c = clients.get(url)
  if (!c) {
    // Base's client has OP-stack block types; the checks only use generic calls.
    c = createPublicClient({
      chain,
      transport: http(url, { timeout: 30_000 }),
    }) as PublicClient
    clients.set(url, c)
  }
  return c
}

const vault4626 = parseAbi(["function asset() view returns (address)"])
const blue = parseAbi([
  "function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
])

// Caches a read per chain and address; a failed read is dropped so it can be retried.
function cached<T>(read: (chainId: number, key: string) => Promise<T>) {
  const seen = new Map<string, Promise<T>>()
  return (chainId: number, key: string) => {
    const k = `${chainId}:${key.toLowerCase()}`
    let p = seen.get(k)
    if (!p) {
      p = read(chainId, key)
      p.catch(() => seen.delete(k))
      seen.set(k, p)
    }
    return p
  }
}

export function chainReader(rpcs: Rpcs = {}): Reader {
  return {
    vaultAsset: cached((chainId, vault) =>
      clientFor(chainId, rpcs).readContract({
        address: vault as Address,
        abi: vault4626,
        functionName: "asset",
      }),
    ),
    token: cached((chainId, address) => {
      const c = clientFor(chainId, rpcs)
      return Promise.all([
        c.readContract({
          address: address as Address,
          abi: erc20Abi,
          functionName: "symbol",
        }),
        c.readContract({
          address: address as Address,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      ]).then(([symbol, decimals]) => ({
        address: address as Address,
        symbol,
        decimals,
      }))
    }),
    market: cached(async (chainId, id) => {
      const blueAddress = morphoContracts(chainId).find(
        (c) => c.name === "Morpho Blue",
      )?.address as Address
      const [loanToken, collateralToken, oracle, irm, lltv] = await clientFor(
        chainId,
        rpcs,
      ).readContract({
        address: blueAddress,
        abi: blue,
        functionName: "idToMarketParams",
        args: [id as Hex],
      })
      return { loanToken, collateralToken, oracle, irm, lltv }
    }),
  }
}
