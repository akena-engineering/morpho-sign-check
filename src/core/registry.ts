import { addresses } from "@morpho-org/morpho-ts"
import type { Address } from "viem"

// Morpho's own published deployments (@morpho-org/morpho-ts). Only contracts a prepared call may
// target or approve; the token entries of the package (wNative, dai, …) are not spenders.
export type Contract = { name: string; address: Address }

export function morphoContracts(chainId: number): Contract[] {
  const a = (addresses as unknown as Record<number, Record<string, unknown>>)[
    chainId
  ]
  if (!a) return []
  const out: Contract[] = []
  const add = (name: string, v: unknown) => {
    if (typeof v === "string") out.push({ name, address: v as Address })
  }
  add("Morpho Blue", a.blue)
  add("Permit2", a.permit2)
  const bundles = (a.bundles ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(bundles)) add(k, v)
  return out
}

export function contractName(
  chainId: number,
  address: Address,
): string | undefined {
  return morphoContracts(chainId).find((c) => sameAddress(c.address, address))
    ?.name
}

export const sameAddress = (a?: string, b?: string) =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase()
