import { zeroAddress } from "viem"
import { describe, expect, it } from "vitest"
import { verdict } from "./checks"
import { type SimResult, simChecks, type Transfer } from "./flows"
import { resolveIntent } from "./intent"
import { fakeReader, fixture, STEAK, STRANGER, USDC } from "./testing"

const BUNDLE = "0x02912516d49dE997db75B9D7858faAE59209650B"

async function deposit() {
  const f = fixture("eth-deposit-v1")
  const intent = await resolveIntent(f.tool, f.args, fakeReader)
  return { f, intent, user: intent.user }
}
const ok = (transfers: Transfer[]): SimResult => ({ kind: "ok", transfers })

describe("simChecks", () => {
  it("passes when the user sends exactly the deposit and receives shares", async () => {
    const { f, intent, user } = await deposit()
    const sim = ok([
      { token: USDC.address, from: user, to: BUNDLE, value: 100_000_000n },
      {
        token: USDC.address,
        from: BUNDLE,
        to: STEAK.address,
        value: 100_000_000n,
      },
      {
        token: STEAK.address,
        from: zeroAddress,
        to: user,
        value: 87_180_431_107_967_408_382n,
      },
    ])
    const fs = simChecks(intent, f.op, sim, [USDC, STEAK])
    expect(verdict(fs)).toBe("PASS")
    expect(fs.map((x) => x.title)).toContain("You receive 87.1804 steakUSDC")
    expect(fs.find((x) => x.id === "sim-server")?.status).toBe("pass")
  })

  it("stops when anything else leaves the wallet", async () => {
    const { f, intent, user } = await deposit()
    const sim = ok([
      { token: USDC.address, from: user, to: BUNDLE, value: 100_000_000n },
      {
        token: STEAK.address,
        from: zeroAddress,
        to: user,
        value: 87n * 10n ** 18n,
      },
      {
        token: STEAK.address,
        from: user,
        to: STRANGER,
        value: 87n * 10n ** 18n,
      },
    ])
    const fs = simChecks(intent, f.op, sim, [USDC, STEAK])
    expect(fs.find((x) => x.id === "sim-in")?.status).toBe("stop")
    expect(verdict(fs)).toBe("STOP")
  })

  it("stops when more than the deposit leaves", async () => {
    const { f, intent, user } = await deposit()
    const sim = ok([
      { token: USDC.address, from: user, to: BUNDLE, value: 1_000_000_000n },
      {
        token: STEAK.address,
        from: zeroAddress,
        to: user,
        value: 870n * 10n ** 18n,
      },
    ])
    const out = simChecks(intent, f.op, sim, [USDC, STEAK]).find(
      (x) => x.id === "sim-out",
    )
    expect(out).toMatchObject({
      status: "stop",
      title: "You'd send 1000 USDC, not 100 USDC",
    })
  })

  it("a revert is STOP, an unreachable RPC is CHECK", async () => {
    const { f, intent } = await deposit()
    expect(
      verdict(
        simChecks(intent, f.op, { kind: "reverted", call: 1, reason: "x" }, []),
      ),
    ).toBe("STOP")
    expect(
      verdict(
        simChecks(intent, f.op, { kind: "unavailable", reason: "timeout" }, []),
      ),
    ).toBe("CHECK")
  })

  it("flags a difference from Morpho's own simulation for the user", async () => {
    const { f, intent, user } = await deposit()
    const sim = ok([
      { token: USDC.address, from: user, to: BUNDLE, value: 100_000_000n },
      {
        token: STEAK.address,
        from: zeroAddress,
        to: user,
        value: 80n * 10n ** 18n,
      },
    ])
    expect(
      simChecks(intent, f.op, sim, [USDC, STEAK]).find(
        (x) => x.id === "sim-server",
      )?.status,
    ).toBe("check")
  })
})

describe("pasted calls", () => {
  it("no server simulation is CHECK for a server response, a note for pasted calls", async () => {
    const { f, intent, user } = await deposit()
    const sim = ok([
      { token: USDC.address, from: user, to: BUNDLE, value: 100_000_000n },
      {
        token: STEAK.address,
        from: zeroAddress,
        to: user,
        value: 87n * 10n ** 18n,
      },
    ])
    const op = { ...f.op, simulation: undefined }
    const server = simChecks(intent, op, sim, [USDC, STEAK])
    const pasted = simChecks(intent, op, sim, [USDC, STEAK], false)
    expect(server.find((x) => x.id === "sim-server")?.status).toBe("check")
    expect(pasted.find((x) => x.id === "sim-server")?.status).toBe("note")
  })
})

describe("the deposit reaches the vault", () => {
  it("stops when part of the deposit goes somewhere else, and names where", async () => {
    const { f, intent, user } = await deposit()
    const sim = ok([
      { token: USDC.address, from: user, to: BUNDLE, value: 100_000_000n },
      { token: USDC.address, from: BUNDLE, to: STRANGER, value: 5_000_000n },
      {
        token: USDC.address,
        from: BUNDLE,
        to: STEAK.address,
        value: 95_000_000n,
      },
      {
        token: STEAK.address,
        from: zeroAddress,
        to: user,
        value: 82n * 10n ** 18n,
      },
    ])
    const v = simChecks(intent, f.op, sim, [USDC, STEAK], false).find(
      (x) => x.id === "sim-vault",
    )
    expect(v).toMatchObject({
      status: "stop",
      title: "Only 95 USDC of your 100 USDC reach the vault",
    })
    expect(v?.detail).toContain("5 USDC goes to 0xBAd0…0Bad")
  })

  it("passes when all of it arrives", async () => {
    const { f, intent, user } = await deposit()
    const sim = ok([
      { token: USDC.address, from: user, to: BUNDLE, value: 100_000_000n },
      {
        token: USDC.address,
        from: BUNDLE,
        to: STEAK.address,
        value: 100_000_000n,
      },
      {
        token: STEAK.address,
        from: zeroAddress,
        to: user,
        value: 87n * 10n ** 18n,
      },
    ])
    expect(
      simChecks(intent, f.op, sim, [USDC, STEAK]).find(
        (x) => x.id === "sim-vault",
      )?.status,
    ).toBe("pass")
  })

  it("flags the vault moving the deposit on to an address that isn't Morpho's", async () => {
    const { f, intent, user } = await deposit()
    const BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
    const sim = ok([
      { token: USDC.address, from: user, to: BUNDLE, value: 100_000_000n },
      {
        token: USDC.address,
        from: BUNDLE,
        to: STEAK.address,
        value: 100_000_000n,
      },
      {
        token: USDC.address,
        from: STEAK.address,
        to: BLUE,
        value: 95_000_000n,
      },
      {
        token: USDC.address,
        from: STEAK.address,
        to: STRANGER,
        value: 5_000_000n,
      },
      {
        token: STEAK.address,
        from: zeroAddress,
        to: user,
        value: 87n * 10n ** 18n,
      },
    ])
    const fs = simChecks(intent, f.op, sim, [USDC, STEAK], false).filter(
      (x) => x.id === "sim-vault",
    )
    expect(fs).toEqual([
      expect.objectContaining({ status: "pass" }),
      {
        id: "sim-vault",
        status: "check",
        title: "The vault moves 5 USDC on to 0xBAd0…0Bad",
        detail:
          "Not a Morpho contract we know; it may be the vault's own allocation.",
      },
    ])
  })

  it("passes the vault allocating to Morpho Blue", async () => {
    const { f, intent, user } = await deposit()
    const BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
    const sim = ok([
      { token: USDC.address, from: user, to: BUNDLE, value: 100_000_000n },
      {
        token: USDC.address,
        from: BUNDLE,
        to: STEAK.address,
        value: 100_000_000n,
      },
      {
        token: USDC.address,
        from: STEAK.address,
        to: BLUE,
        value: 100_000_000n,
      },
    ])
    const fs = simChecks(intent, f.op, sim, [USDC, STEAK], false).filter(
      (x) => x.id === "sim-vault",
    )
    expect(fs.map((x) => x.status)).toEqual(["pass"])
  })
})
