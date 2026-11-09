import { encodeFunctionData, maxUint256, parseAbi } from "viem"
import { describe, expect, it } from "vitest"
import { type Finding, staticChecks, verdict } from "./checks"
import { decodeCall } from "./decode"
import { resolveIntent } from "./intent"
import type { PreparedOperation } from "./operation"
import { fakeReader, fixture, STRANGER, tamper } from "./testing"

async function run(name: string, op?: PreparedOperation) {
  const f = fixture(name)
  const intent = await resolveIntent(f.tool, f.args, fakeReader)
  const findings = staticChecks(intent, op ?? f.op, f.now)
  return { findings, verdict: verdict(findings) }
}
const stops = (fs: Finding[]) =>
  fs.filter((f) => f.status === "stop").map((f) => f.id)

describe("real prepared operations", () => {
  it("deposit: every call checks out", async () => {
    const r = await run("eth-deposit-v1")
    expect(stops(r.findings)).toEqual([])
    expect(r.verdict).toBe("PASS")
    expect(r.findings.map((f) => f.title)).toContain(
      "Approves exactly 100 USDC to vaultBundlesV1",
    )
  })

  it("borrow: unlimited approval to Morpho's bundle is CHECK, not STOP", async () => {
    const r = await run("eth-collateral-borrow")
    expect(stops(r.findings)).toEqual([])
    expect(r.verdict).toBe("CHECK")
    const approve = r.findings.find((x) => x.id === "approve-amount")
    expect(approve?.title).toBe("Unlimited wstETH approval to blueBundlesV1")
    expect(approve?.detail).toContain("1 wstETH would be enough")
  })

  it("stops on the server's own error warning", async () => {
    // The example wallet holds no USDC on Base, so Morpho's simulation reverted.
    const r = await run("base-deposit-v2")
    expect(stops(r.findings)).toEqual(["server-warning"])
  })
})

describe("tampered deposit", () => {
  const base = () => fixture("eth-deposit-v1").op

  it("approval to a stranger", async () => {
    const op = tamper(base(), 0, (a) => [STRANGER, a[1]])
    const r = await run("eth-deposit-v1", op)
    expect(stops(r.findings)).toContain("approve-spender")
    expect(r.verdict).toBe("STOP")
  })

  it("unlimited approval to a stranger is STOP", async () => {
    const op = tamper(base(), 0, () => [STRANGER, maxUint256])
    expect(stops((await run("eth-deposit-v1", op)).findings)).toContain(
      "approve-spender",
    )
  })

  it("approval larger than the deposit is CHECK", async () => {
    const op = tamper(base(), 0, (a) => [a[0], 500_000_000n])
    const r = await run("eth-deposit-v1", op)
    expect(r.findings.find((f) => f.id === "approve-amount")?.status).toBe(
      "check",
    )
  })

  it("vault swapped", async () => {
    const op = tamper(base(), 1, (a) => [STRANGER, ...a.slice(1)])
    expect(stops((await run("eth-deposit-v1", op)).findings)).toContain("vault")
  })

  it("referral fee to a stranger", async () => {
    // 5% (WAD) to STRANGER: same vault, same amount.
    const op = tamper(base(), 1, (a) => [
      ...a.slice(0, 4),
      50_000_000_000_000_000n,
      STRANGER,
      a[6],
    ])
    const r = await run("eth-deposit-v1", op)
    const fee = r.findings.find((f) => f.id === "fee")
    expect(fee?.status).toBe("stop")
    expect(fee?.title).toBe("Sends a 5% referral fee to 0xBAd0…0Bad")
  })

  it("amount ×10 while the description still says 100", async () => {
    const op = tamper(base(), 1, (a) => [a[0], 1_000_000_000n, ...a.slice(2)])
    const r = await run("eth-deposit-v1", op)
    expect(stops(r.findings)).toContain("amount")
  })

  it("description that disagrees with the approval", async () => {
    const op = base()
    const tx0 = op.transactions[0]
    if (!tx0) throw new Error("fixture changed")
    const changed = {
      ...op,
      transactions: [
        { ...tx0, description: "Approve vault to spend 5 of USDC" },
        ...op.transactions.slice(1),
      ],
    }
    expect(stops((await run("eth-deposit-v1", changed)).findings)).toContain(
      "description",
    )
  })

  it("an extra direct transfer appended", async () => {
    const op = base()
    const usdc = op.transactions[0]
    if (!usdc) throw new Error("fixture changed")
    const data = encodeFunctionData({
      abi: parseAbi(["function transfer(address to, uint256 amount)"]),
      args: [STRANGER, 100_000_000n],
    })
    const r = await run("eth-deposit-v1", {
      ...op,
      transactions: [...op.transactions, { ...usdc, data, description: "" }],
    })
    expect(stops(r.findings)).toContain("transfer")
  })

  it("a call on another chain", async () => {
    const op = base()
    const transactions = op.transactions.map((t, i) =>
      i === 1 ? { ...t, chainId: "8453" } : t,
    )
    expect(
      stops((await run("eth-deposit-v1", { ...op, transactions })).findings),
    ).toContain("chain")
  })

  it("USDT-style reset to 0 before the approval passes", async () => {
    const op = base()
    const tx0 = op.transactions[0]
    if (!tx0) throw new Error("fixture changed")
    const reset = tamper(op, 0, (a) => [a[0], 0n]).transactions[0]
    if (!reset) throw new Error("fixture changed")
    const r = await run("eth-deposit-v1", {
      ...op,
      transactions: [{ ...reset, description: "" }, ...op.transactions],
    })
    expect(r.verdict).toBe("PASS")
  })

  it("an unknown selector on a Morpho contract is CHECK, elsewhere STOP", async () => {
    const op = base()
    const tx1 = op.transactions[1]
    if (!tx1) throw new Error("fixture changed")
    const odd = { ...tx1, data: "0xdeadbeef" as const, description: "" }
    const r1 = await run("eth-deposit-v1", {
      ...op,
      transactions: [op.transactions[0] ?? tx1, odd],
    })
    expect(r1.findings.find((f) => f.id === "decoded")?.status).toBe("check")
    const r2 = await run("eth-deposit-v1", {
      ...op,
      transactions: [op.transactions[0] ?? tx1, { ...odd, to: STRANGER }],
    })
    expect(stops(r2.findings)).toContain("target")
  })
})

describe("decodeCall", () => {
  it("computes the market id of a borrow bundle", () => {
    const f = fixture("eth-collateral-borrow")
    const tx = f.op.transactions[2]
    if (!tx) throw new Error("fixture changed")
    const d = decodeCall(tx)
    expect(d.kind === "bundle" && d.marketId).toBe(f.args.marketId)
  })
})

describe("tamper scenarios", () => {
  it.each(["spender", "fee", "amount", "vault"] as const)(
    "%s turns the real deposit into STOP",
    async (kind) => {
      const { tamper: apply } = await import("./tamper")
      const op = apply(fixture("eth-deposit-v1").op, kind)
      expect((await run("eth-deposit-v1", op)).verdict).toBe("STOP")
    },
  )
})
