import {
  type Abi,
  type Address,
  decodeFunctionData,
  encodeFunctionData,
  type Hex,
  parseAbi,
} from "viem"
import blueBundles from "./abis/blueBundlesV1.json"
import vaultBundles from "./abis/vaultBundlesV1.json"
import type { PreparedOperation } from "./operation"

// Synthetic changes to a real prepared operation, for the demo and the tests: "what if the response
// were changed on its way to the wallet". Each one re-encodes the calldata so it stays valid.
export const STRANGER: Address = "0xBAd0000000000000000000000000000000000Bad"

export const TAMPERS = {
  spender: "Approval goes to a stranger",
  fee: "A 5% referral fee to a stranger",
  amount: "Amount ×10, description unchanged",
  vault: "Different vault",
} as const
export type TamperKind = keyof typeof TAMPERS

const ABI: Abi = [
  ...(vaultBundles as Abi),
  ...(blueBundles as Abi),
  ...parseAbi(["function approve(address spender, uint256 amount)"]),
]

export function argIndex(fn: string, name: string) {
  const item = ABI.find((x) => x.type === "function" && x.name === fn)
  return item?.type === "function"
    ? item.inputs.findIndex((i) => i.name === name)
    : -1
}

// Re-encodes call i with some arguments replaced.
export function rewrite(
  op: PreparedOperation,
  i: number,
  change: (args: unknown[], fn: string) => unknown[],
): PreparedOperation {
  const tx = op.transactions[i]
  if (!tx) throw new Error(`no call ${i}`)
  const d = decodeFunctionData({ abi: ABI, data: tx.data })
  const data = encodeFunctionData({
    abi: ABI,
    functionName: d.functionName,
    args: change([...(d.args ?? [])], d.functionName),
  } as Parameters<typeof encodeFunctionData>[0]) as Hex
  return {
    ...op,
    transactions: op.transactions.map((t, j) => (j === i ? { ...t, data } : t)),
  }
}

const fnOf = (op: PreparedOperation, i: number) => {
  try {
    const tx = op.transactions[i]
    return tx
      ? decodeFunctionData({ abi: ABI, data: tx.data }).functionName
      : undefined
  } catch {
    return undefined
  }
}

export function tamper(
  op: PreparedOperation,
  kind: TamperKind,
): PreparedOperation {
  const fns = op.transactions.map((_, i) => fnOf(op, i))
  const approve = fns.indexOf("approve")
  const bundle = fns.findIndex((f) => f !== undefined && /BundlesV1/.test(f))
  const set = (i: number, names: Record<string, (v: unknown) => unknown>) =>
    rewrite(op, i, (args, fn) => {
      for (const [name, to] of Object.entries(names)) {
        const k = argIndex(fn, name)
        if (k < 0) throw new Error(`${fn} has no ${name}`)
        args[k] = to(args[k])
      }
      return args
    })
  switch (kind) {
    case "spender":
      if (approve < 0) throw new Error("no approval to change")
      return set(approve, { spender: () => STRANGER })
    case "fee":
      return set(bundle, {
        referralFeePct: () => 50_000_000_000_000_000n,
        referralFeeRecipient: () => STRANGER,
      })
    case "amount": {
      const fn = fns[bundle] ?? ""
      const name = argIndex(fn, "assets") >= 0 ? "assets" : "collateralAssets"
      return set(bundle, { [name]: (v) => (v as bigint) * 10n })
    }
    case "vault":
      return set(bundle, { vault: () => STRANGER })
  }
}
