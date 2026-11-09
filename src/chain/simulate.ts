import { type Address, decodeEventLog, parseAbi } from "viem"
import type { SimResult, Transfer } from "../core/flows"
import type { PreparedOperation } from "../core/operation"
import { revertReason } from "../core/reason"
import { clientFor, type Rpcs, redact } from "./client"

const transferEvent = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
])

// Runs every prepared call in order, from the user, in one simulated block on our own RPC
// (eth_simulateV1), and returns the ERC-20 transfers it caused. Real balances, no overrides: if the
// wallet can't afford it, the simulation says so.
export async function simulate(
  op: PreparedOperation,
  chainId: number,
  user: Address,
  rpcs: Rpcs = {},
): Promise<SimResult> {
  try {
    const { results } = await clientFor(chainId, rpcs).simulateCalls({
      account: user,
      calls: op.transactions.map((t) => ({
        to: t.to,
        data: t.data,
        value: BigInt(t.value),
      })),
    })
    const failed = results.findIndex((r) => r.status !== "success")
    if (failed >= 0) {
      const r = results[failed]
      const reason =
        r?.status === "failure"
          ? redact(revertReason(r.error.message), rpcs)
          : "unknown"
      return { kind: "reverted", call: failed, reason }
    }
    const transfers: Transfer[] = []
    for (const r of results)
      for (const log of r.logs ?? []) {
        try {
          const e = decodeEventLog({
            abi: transferEvent,
            data: log.data,
            topics: log.topics,
          })
          transfers.push({
            token: log.address,
            from: e.args.from,
            to: e.args.to,
            value: e.args.value,
          })
        } catch {
          // Not an ERC-20 Transfer (Morpho's own events, approvals).
        }
      }
    return { kind: "ok", transfers }
  } catch (e) {
    return {
      kind: "unavailable",
      reason: redact(
        (e as { shortMessage?: string }).shortMessage ?? String(e),
        rpcs,
      ),
    }
  }
}
