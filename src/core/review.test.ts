// One test per finding of the Codex reviews of this repo, each with the failing
// input it described. None of these may PASS.
import { encodeFunctionData, parseAbi, zeroAddress } from "viem"
import { describe, expect, it } from "vitest"
import { redact } from "../chain/client"
import { checkOperation } from "../check"
import { type Finding, staticChecks, verdict } from "./checks"
import { type SimResult, simChecks } from "./flows"
import { resolveIntent } from "./intent"
import type { PreparedOperation, PreparedTx } from "./operation"
import { findPayload } from "./payload"
import { rewrite } from "./tamper"
import { fakeReader, fixture, STEAK, USDC, WSTETH } from "./testing"

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"
const BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
const abi = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function setAuthorization(address authorized, bool newIsAuthorized)",
])
const call = (to: `0x${string}`, data: `0x${string}`): PreparedTx => ({
  to,
  data,
  value: "0",
  chainId: "1",
  description: "",
})
const ids = (fs: Finding[], status: Finding["status"]) =>
  fs.filter((f) => f.status === status).map((f) => f.id)

async function statics(name: string, op: PreparedOperation, args?: object) {
  const f = fixture(name)
  const intent = await resolveIntent(f.tool, { ...f.args, ...args }, fakeReader)
  return staticChecks(intent, op, f.now)
}

describe("Codex review 1", () => {
  it("1: a collateral-only request can't become a borrow", async () => {
    const f = fixture("eth-collateral-borrow")
    const op = rewrite(f.op, 0, (a) => [a[0], 10n ** 18n])
    const intent = await resolveIntent(
      "morpho_prepare_supply_collateral",
      {
        chain: "ethereum",
        marketId: f.args.marketId,
        userAddress: f.args.userAddress,
        amount: "1",
      },
      fakeReader,
    )
    const fs = staticChecks(intent, op, f.now)
    expect(verdict(fs)).toBe("STOP")
    expect(
      fs.find((x) => x.id === "amount" && x.status === "stop")?.title,
    ).toBe("Also borrows 1000 USDC, which you didn't ask for")
  })

  it("2: an extra approval to another Morpho contract is STOP", async () => {
    const op = fixture("eth-deposit-v1").op
    const extra = call(
      USDC.address,
      encodeFunctionData({
        abi,
        functionName: "approve",
        args: [PERMIT2, 100_000_000n],
      }),
    )
    const fs = await statics("eth-deposit-v1", {
      ...op,
      transactions: [...op.transactions, extra],
    })
    expect(ids(fs, "stop")).toContain("approve-spender")
  })

  it("3: an unrequested Blue authorization is STOP", async () => {
    const op = fixture("eth-deposit-v1").op
    const extra = call(
      BLUE,
      encodeFunctionData({
        abi,
        functionName: "setAuthorization",
        args: [PERMIT2, true],
      }),
    )
    const fs = await statics("eth-deposit-v1", {
      ...op,
      transactions: [...op.transactions, extra],
    })
    expect(ids(fs, "stop")).toContain("authorize")
  })

  it("4: a non-empty permit inside the bundle is CHECK", async () => {
    const op = rewrite(fixture("eth-deposit-v1").op, 1, (a) => [
      ...a.slice(0, 3),
      { kind: 1, data: "0x1234" },
      ...a.slice(4),
    ])
    const fs = await statics("eth-deposit-v1", op)
    expect(ids(fs, "check")).toContain("permit")
    expect(verdict(fs)).not.toBe("PASS")
  })

  it("5: a failing step keeps the STOP found before it", async () => {
    const { tamper } = await import("./tamper")
    const f = fixture("eth-deposit-v1")
    const broken = {
      ...fakeReader,
      vaultAsset: () => Promise.reject(new Error("rpc down")),
    }
    const r = await checkOperation(f.tool, f.args, tamper(f.op, "fee"), {
      reader: broken,
      rpcs: { 1: "http://127.0.0.1:9" },
      now: f.now,
    })
    expect(r.verdict).toBe("STOP")
    expect(r.findings.some((x) => x.title.includes("rpc down"))).toBe(true)
    expect(r.findings.find((x) => x.id === "sim")?.status).toBe("check")
  }, 60_000)

  it("6: the proxy finds exactly one operation, or none", () => {
    const op = JSON.stringify(fixture("eth-deposit-v1").op)
    const other = JSON.stringify({ transactions: [] })
    expect(findPayload([{ type: "text", text: op }]).kind).toBe("one")
    expect(findPayload([{ type: "text", text: `\n  ${op}` }]).kind).toBe("one")
    expect(
      findPayload([
        { type: "text", text: op },
        { type: "text", text: other },
      ]).kind,
    ).toBe("unreadable")
    expect(
      findPayload([{ type: "text", text: op }], { transactions: [] }).kind,
    ).toBe("unreadable")
    expect(findPayload([{ type: "text", text: "{not json" }]).kind).toBe("none")
  })

  it("7: a requested outgoing move that never happens is STOP", async () => {
    const f = fixture("eth-deposit-v1")
    const intent = await resolveIntent(f.tool, f.args, fakeReader)
    const op = { ...f.op, transactions: [], simulation: undefined }
    const fs = simChecks(intent, op, { kind: "ok", transfers: [] }, [
      USDC,
      STEAK,
    ])
    expect(fs.find((x) => x.id === "sim-out")).toMatchObject({
      status: "stop",
      title: "You don't send any USDC",
    })
  })

  it("8: max, missing and over-precise amounts are CHECK", async () => {
    const op = fixture("eth-deposit-v1").op
    for (const amount of ["max", undefined, "0.0000009"]) {
      const fs = await statics("eth-deposit-v1", op, { amount })
      expect(ids(fs, "check")).toContain("intent")
      expect(verdict(fs)).toBe("CHECK")
    }
  })

  it("9: no server simulation, or an unreadable server token, is CHECK", async () => {
    const f = fixture("eth-deposit-v1")
    const intent = await resolveIntent(f.tool, f.args, fakeReader)
    const user = intent.user
    const ok = {
      kind: "ok" as const,
      transfers: [
        {
          token: USDC.address,
          from: user,
          to: zeroAddress,
          value: 100_000_000n,
        },
        {
          token: STEAK.address,
          from: zeroAddress,
          to: user,
          value: 87n * 10n ** 18n,
        },
      ],
    }
    const none = simChecks(intent, { ...f.op, simulation: undefined }, ok, [
      USDC,
      STEAK,
    ])
    expect(none.find((x) => x.id === "sim-server")?.status).toBe("check")
    const odd = {
      ...f.op,
      simulation: {
        transfers: [
          ...(f.op.simulation?.transfers ?? []),
          {
            token: { address: WSTETH.address, symbol: "X" },
            from: user,
            to: zeroAddress,
            amount: { symbol: "X", value: "5" },
          },
        ],
      },
    }
    // wstETH isn't in the token list here, so its amount can't be read.
    expect(
      simChecks(intent, odd, ok, [USDC, STEAK]).find(
        (x) => x.id === "sim-server",
      )?.status,
    ).toBe("check")
  })
})

describe("approvals", () => {
  it("approving a token the request doesn't send is STOP, even a known one", async () => {
    const f = fixture("eth-collateral-borrow")
    // Approve USDC (the token being borrowed) instead of wstETH.
    const op = {
      ...f.op,
      transactions: f.op.transactions.map((t, i) =>
        i === 0 ? { ...t, to: USDC.address, description: "" } : t,
      ),
    }
    const fs = await statics("eth-collateral-borrow", op)
    expect(ids(fs, "stop")).toContain("approve-token")
  })
})

describe("Codex review 2", () => {
  it("1: an approval after the bundle is STOP", async () => {
    const op = fixture("eth-deposit-v1").op
    const [approve, deposit] = op.transactions
    if (!approve || !deposit) throw new Error("fixture changed")
    const fs = await statics("eth-deposit-v1", {
      ...op,
      transactions: [deposit, approve],
    })
    expect(ids(fs, "stop")).toContain("order")
  })

  it("2: no price limit or a far deadline is CHECK; the real ones pass", async () => {
    const f = fixture("eth-deposit-v1")
    const real = await statics("eth-deposit-v1", f.op)
    expect(real.find((x) => x.id === "deadline")?.status).toBe("pass")
    const loose = rewrite(f.op, 1, (a) => [...a.slice(0, 6), 2n ** 256n - 1n])
    expect(
      (await statics("eth-deposit-v1", loose)).find((x) => x.id === "deadline")
        ?.status,
    ).toBe("check")
    const intent = await resolveIntent(f.tool, f.args, fakeReader)
    const user = intent.user
    const flows = {
      kind: "ok" as const,
      transfers: [
        // user → bundle → vault, and shares minted to the user
        {
          token: USDC.address,
          from: user,
          to: "0x02912516d49dE997db75B9D7858faAE59209650B",
          value: 100_000_000n,
        },
        {
          token: USDC.address,
          from: "0x02912516d49dE997db75B9D7858faAE59209650B",
          to: STEAK.address,
          value: 100_000_000n,
        },
        {
          token: STEAK.address,
          from: zeroAddress,
          to: user,
          value: 87_180_431_107_967_408_382n,
        },
      ],
    } satisfies SimResult
    const price = (op: PreparedOperation) =>
      simChecks(intent, op, flows, [USDC, STEAK]).find((x) => x.id === "price")
    expect(price(f.op)?.status).toBe("pass")
    const unlimited = rewrite(f.op, 1, (a) => [
      a[0],
      a[1],
      2n ** 256n - 1n,
      ...a.slice(3),
    ])
    expect(price(unlimited)).toMatchObject({
      status: "check",
      title: "No limit on the share price",
    })
  })

  it("3: an unreadable ETH value is STOP and keeps the fee STOP", async () => {
    const { tamper } = await import("./tamper")
    const op = tamper(fixture("eth-deposit-v1").op, "fee")
    const odd = {
      ...op,
      transactions: [
        ...op.transactions,
        { ...op.transactions[0], value: "not-an-integer" } as PreparedTx,
      ],
    }
    const fs = await statics("eth-deposit-v1", odd)
    expect(ids(fs, "stop")).toEqual(expect.arrayContaining(["fee", "value"]))
  })

  it("4: max is CHECK, not a false STOP", async () => {
    const fs = await statics("eth-deposit-v1", fixture("eth-deposit-v1").op, {
      amount: "max",
    })
    expect(verdict(fs)).toBe("CHECK")
  })

  it("5: unreadable request tokens don't turn a real deposit into STOP", async () => {
    const f = fixture("eth-deposit-v1")
    const broken = {
      ...fakeReader,
      vaultAsset: () => Promise.reject(new Error("rpc down")),
    }
    const r = await checkOperation(f.tool, f.args, f.op, {
      reader: broken,
      rpcs: { 1: "http://127.0.0.1:9" },
      now: f.now,
    })
    expect(r.verdict).toBe("CHECK")
  }, 60_000)

  it("6: structuredContent that differs anywhere from the text is unreadable", () => {
    const op = fixture("eth-deposit-v1").op
    const text = JSON.stringify(op)
    const reordered = JSON.parse(text)
    expect(findPayload([{ type: "text", text }], reordered).kind).toBe("one")
    const warned = {
      ...JSON.parse(text),
      warnings: [{ level: "error", message: "simulation reverted" }],
    }
    expect(findPayload([{ type: "text", text }], warned).kind).toBe(
      "unreadable",
    )
  })
})

describe("Codex review 5 (pre-release)", () => {
  it("2: an RPC URL with a key never reaches a finding", () => {
    const url = "https://eth.example/v2/SECRET"
    expect(redact(`HTTP request failed. URL: ${url}`, { 1: url })).toBe(
      "HTTP request failed. URL: <your RPC>",
    )
  })

  it("4: a description that writes 100 as 100.0 isn't a mismatch", async () => {
    const f = fixture("eth-deposit-v1")
    const op = {
      ...f.op,
      transactions: f.op.transactions.map((t, i) =>
        i === 1 ? { ...t, description: "Deposit 100.0 USDC into vault" } : t,
      ),
    }
    expect(ids(await statics("eth-deposit-v1", op), "stop")).not.toContain(
      "description",
    )
  })
})
