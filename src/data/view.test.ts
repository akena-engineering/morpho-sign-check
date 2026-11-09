import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Report } from "../check"
import { staticChecks, verdict } from "../core/checks"
import { decodeCall } from "../core/decode"
import { resolveIntent } from "../core/intent"
import { tamper } from "../core/tamper"
import { fakeReader, fixture } from "../core/testing"
import {
  EXAMPLE_TO,
  EXAMPLE_USER,
  EXAMPLE_VAULT,
  examples,
  InputError,
  prepare,
  readPaste,
  withAssumedTarget,
} from "./own"
import { Scenario, ScenarioFile } from "./scenarios"
import { scenarioView } from "./view"

// The page's view, built the way `pnpm scenarios` builds it (minus the live simulation), must have
// the same calls, links and statuses as public/data/scenarios.json: the browser's "Check your own"
// uses this same function.
const published = ScenarioFile.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../public/data/scenarios.json"),
      "utf8",
    ),
  ),
)
// The bundle call exactly as Morpho prepared it.
const MORPHO = fixture("eth-deposit-v1").op.transactions
const EXAMPLE_A = MORPHO[1]?.data ?? "0x"
const DEPOSIT = "Deposit [100 USDC](asset) into [Steakhouse USDC](vault)."

async function view(id: string, kind?: "fee") {
  const f = fixture("eth-deposit-v1")
  const op = kind ? tamper(f.op, kind) : f.op
  const intent = await resolveIntent(f.tool, f.args, fakeReader)
  const findings = staticChecks(intent, op, f.now)
  const report: Report = {
    intent,
    findings,
    verdict: verdict(findings),
    sim: { kind: "unavailable", reason: "offline test" },
    tokens: intent.moves.map((m) => m.token),
  }
  return scenarioView({
    id,
    label: id,
    request: DEPOSIT,
    tool: f.tool,
    server: "test",
    probedAt: "2026-11-05T00:00:00.000Z",
    op,
    report,
    read: fakeReader,
    original: kind ? f.op : undefined,
  })
}

// What the read-back draws: everything but time-dependent notes.
const shape = (s: Scenario) => ({
  request: s.request,
  requestParts: s.requestParts,
  tampered: s.tampered,
  calls: s.calls.map((c) => ({
    target: c.target,
    fn: c.fn,
    added: c.added,
    args: c.args.map(({ name, value, changed, link, status }) => ({
      name,
      value,
      changed,
      link,
      status,
    })),
  })),
})
const publishedShape = (id: string) => {
  const s = published.scenarios.find((s) => s.id === id)
  if (!s) throw new Error(`no ${id} in scenarios.json`)
  return shape(s)
}

describe("scenarioView", () => {
  it("reads the deposit back like scenarios.json", async () => {
    const s = Scenario.parse(await view("deposit"))
    expect(shape(s)).toEqual(publishedShape("deposit"))
    expect(s.wallet).toEqual({
      sim: "unavailable",
      changes: [],
      note: "offline test",
    })
  })

  it("flags the referral fee as not in the request, like scenarios.json", async () => {
    const s = Scenario.parse(await view("deposit-fee", "fee"))
    expect(shape(s)).toEqual(publishedShape("deposit-fee"))
    const fee = s.calls[1]?.args.find((a) => a.name === "referral fee")
    expect(fee).toMatchObject({
      link: "unasked",
      status: "stop",
      changed: "none",
    })
    expect(s.verdict).toBe("STOP")
  })
})

describe("readPaste", () => {
  it("takes calldata, a prepared operation and a list of calls", () => {
    expect(readPaste(` ${EXAMPLE_A}\n`)).toEqual({
      kind: "hex",
      data: EXAMPLE_A,
    })
    const raw = readFileSync(
      join(import.meta.dirname, "../core/fixtures/eth-deposit-v1.json"),
      "utf8",
    )
    expect(readPaste(JSON.stringify(JSON.parse(raw).result)).kind).toBe("op")
    expect(readPaste(raw).kind).toBe("op")
    expect(
      readPaste(JSON.stringify([{ to: EXAMPLE_VAULT, data: "0x1234abcd" }])),
    ).toMatchObject({ kind: "calls", calls: [{ to: EXAMPLE_VAULT }] })
    // A call marked for another chain keeps it, so the chain check sees it.
    expect(
      readPaste(
        JSON.stringify([{ to: EXAMPLE_VAULT, data: "0x", chainId: 8453 }]),
      ),
    ).toMatchObject({ calls: [{ chainId: 8453 }] })
  })

  it("says plainly what's wrong", () => {
    for (const bad of ["", "hello", "0x123", "0xzz", "0x12", "{}", '{"a":1}'])
      expect(() => readPaste(bad)).toThrow(InputError)
  })
})

describe("prepare", () => {
  const request = {
    operation: "deposit" as const,
    vault: EXAMPLE_VAULT,
    amount: "100",
    user: EXAMPLE_USER,
  }

  it("adds the same approval Morpho prepares, marked as added", async () => {
    const p = await prepare(
      { request, paste: EXAMPLE_A, to: EXAMPLE_TO, addApproval: true },
      fakeReader,
    )
    expect(p.op.transactions.map((t) => [t.to, t.data])).toEqual(
      MORPHO.map((t) => [t.to, t.data]),
    )
    expect(p.added).toEqual([0])
    expect("original" in p && p.original).toBeFalsy()
    expect("assumed" in p && p.assumed).toBeFalsy()
  })

  it("checks the call alone without the approval, and keeps Example B's original", async () => {
    const alone = await prepare(
      { request, paste: EXAMPLE_A, to: EXAMPLE_TO, addApproval: false },
      fakeReader,
    )
    expect(alone.op.transactions).toHaveLength(1)
    const e = examples()
    const b = await prepare(
      {
        request,
        paste: e.b,
        to: EXAMPLE_TO,
        addApproval: true,
        original: e.a,
      },
      fakeReader,
    )
    expect("original" in b && b.original?.transactions[1]?.data).toBe(e.a)
  })

  it("an inferred “Sent to” is an assumption: CHECK, never PASS", async () => {
    const p = await prepare(
      { request, paste: EXAMPLE_A, to: "", addApproval: true },
      fakeReader,
    )
    const assumed = "assumed" in p ? p.assumed : undefined
    expect(assumed).toEqual({ to: EXAMPLE_TO, call: 1 })
    const passing: Report = {
      intent: await resolveIntent(
        "morpho_prepare_deposit",
        {
          chain: "ethereum",
          vaultAddress: EXAMPLE_VAULT,
          userAddress: EXAMPLE_USER,
          amount: "100",
        },
        fakeReader,
      ),
      findings: [{ id: "chain", status: "pass", title: "ok" }],
      verdict: "PASS",
      sim: { kind: "unavailable", reason: "test" },
      tokens: [],
    }
    const r = withAssumedTarget(passing, assumed)
    expect(r.verdict).toBe("CHECK")
    expect(r.findings.at(-1)).toMatchObject({
      id: "target-assumed",
      status: "check",
      call: 1,
      title:
        "You didn't say where this call goes; Sign Check assumed vaultBundlesV1 0x0291…650B. Check the address in your wallet.",
    })
    expect(withAssumedTarget(passing, undefined)).toBe(passing)
  })

  it("renews only the examples' deadline, and B differs from A only in the fee", async () => {
    const now = 2_000_000_000
    const e = examples(now)
    const args = (data: `0x${string}`) => {
      const d = decodeCall({ ...(MORPHO[1] as (typeof MORPHO)[number]), data })
      if (d.kind !== "bundle") throw new Error("not a bundle call")
      return d.args
    }
    const a = args(e.a)
    const b = args(e.b)
    const morpho = args(EXAMPLE_A)
    expect(a.deadline).toBe(BigInt(now + 3600))
    expect({ ...a, deadline: 0n }).toEqual({ ...morpho, deadline: 0n })
    const changed = Object.keys(a).filter(
      (k) =>
        JSON.stringify(a[k], (_, v) => String(v)) !==
        JSON.stringify(b[k], (_, v) => String(v)),
    )
    expect(changed).toEqual(["referralFeePct", "referralFeeRecipient"])
    // What the user pastes is never re-encoded.
    const pasted = await prepare(
      { request, paste: EXAMPLE_A, to: EXAMPLE_TO, addApproval: true },
      fakeReader,
    )
    expect(pasted.op.transactions[1]?.data).toBe(EXAMPLE_A)
  })

  it("rejects a wallet that isn't an address", async () => {
    await expect(
      prepare(
        {
          request: { ...request, user: "0x123" },
          paste: EXAMPLE_A,
          to: "",
          addApproval: true,
        },
        fakeReader,
      ),
    ).rejects.toThrow(/wallet address/)
  })
})
