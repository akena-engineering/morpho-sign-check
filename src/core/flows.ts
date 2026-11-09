import { type Address, maxUint256, parseUnits } from "viem"
import { type Finding, short } from "./checks"
import { decodeCall } from "./decode"
import type { Intent, Token } from "./intent"
import type { PreparedOperation } from "./operation"
import { contractName, sameAddress } from "./registry"
import { formatAmount as fmt } from "./units"

export type Transfer = {
  token: Address
  from: Address
  to: Address
  value: bigint
}
export type SimResult =
  | { kind: "ok"; transfers: Transfer[] }
  | { kind: "reverted"; call: number; reason: string }
  | { kind: "unavailable"; reason: string }

// Net token change of `user`, by token address (lowercase).
export function netFlows(transfers: Transfer[], user: Address) {
  const net = new Map<string, bigint>()
  for (const t of transfers) {
    const k = t.token.toLowerCase()
    if (sameAddress(t.from, user)) net.set(k, (net.get(k) ?? 0n) - t.value)
    if (sameAddress(t.to, user)) net.set(k, (net.get(k) ?? 0n) + t.value)
  }
  return net
}

// Our simulation against the request: the user sends exactly what they asked, receives what they
// asked, and nothing else leaves the wallet. Then against Morpho's own simulation.
export function simChecks(
  intent: Intent,
  op: PreparedOperation,
  sim: SimResult,
  tokens: Token[],
  // False when the calls didn't come from Morpho's server (pasted calldata): there is no server
  // simulation to miss, so its absence is a note, not a CHECK.
  fromServer = true,
): Finding[] {
  if (sim.kind === "unavailable")
    return [
      {
        id: "sim",
        status: "check",
        title: "Couldn't run our own simulation",
        detail: sim.reason,
      },
    ]
  if (sim.kind === "reverted")
    return [
      {
        id: "sim",
        status: "stop",
        title: `Call ${sim.call + 1} reverts in our simulation`,
        detail: sim.reason,
        call: sim.call,
      },
    ]

  const out: Finding[] = [
    { id: "sim", status: "pass", title: "Our simulation runs every call" },
  ]
  const tokenOf = (a: string) => tokens.find((t) => sameAddress(t.address, a))
  const net = netFlows(sim.transfers, intent.user)

  // Every token the user is asked to send must leave the wallet, by exactly the requested amount.
  for (const m of intent.moves.filter((m) => m.direction === "out")) {
    const sent = -(net.get(m.token.address.toLowerCase()) ?? 0n)
    if (sent <= 0n)
      out.push({
        id: "sim-out",
        status: "stop",
        title: `You don't send any ${m.token.symbol}`,
        detail: "The request moves this token, but the calls don't.",
      })
    else if (m.amount !== undefined && sent !== m.amount)
      out.push({
        id: "sim-out",
        status: "stop",
        title: `You'd send ${fmt(sent, m.token)}, not ${fmt(m.amount, m.token)}`,
      })
    else
      out.push({
        id: "sim-out",
        status: m.amount === undefined ? "check" : "pass",
        title: `You send ${fmt(sent, m.token)}`,
      })
  }
  // Every token the user asked to receive must arrive.
  for (const m of intent.moves.filter((m) => m.direction === "in")) {
    const got = net.get(m.token.address.toLowerCase()) ?? 0n
    if (got <= 0n)
      out.push({
        id: "sim-in",
        status: "stop",
        title: `You don't receive ${m.token.symbol}`,
      })
    else if (m.amount !== undefined && got !== m.amount)
      out.push({
        id: "sim-in",
        status: "stop",
        title: `You receive ${fmt(got, m.token)}, not ${fmt(m.amount, m.token)}`,
      })
    else
      out.push({
        id: "sim-in",
        status: "pass",
        title: `You receive ${fmt(got, m.token)}`,
      })
  }
  // Nothing else may leave the wallet, and nothing unrequested may arrive (a borrow you didn't
  // ask for arrives as tokens, with debt behind it).
  for (const [addr, delta] of net) {
    const expected = intent.moves.some(
      (m) =>
        m.direction === (delta < 0n ? "out" : "in") &&
        sameAddress(m.token.address, addr),
    )
    if (expected || delta === 0n) continue
    out.push(
      delta < 0n
        ? {
            id: "sim-out",
            status: "stop",
            title: `You'd also send ${label(tokenOf(addr), addr, -delta)}`,
            detail: "The request doesn't move this token.",
          }
        : {
            id: "sim-in",
            status: "check",
            title: `You'd also receive ${label(tokenOf(addr), addr, delta)}`,
            detail: "The request doesn't ask for this token.",
          },
    )
  }
  out.push(...reachesVault(intent, sim.transfers, tokenOf))
  const price = priceProtection(intent, op, sim.transfers)
  if (price) out.push(price)
  out.push(
    fromServer
      ? compareWithServer(op, sim.transfers, intent.user, tokenOf)
      : {
          id: "sim-server",
          status: "note",
          title:
            "No Morpho response pasted, so there's no Morpho simulation to compare with",
        },
  )
  return out
}

// The user's own token changes in our simulation and in Morpho's, within 0.01%: the two run on
// different blocks, so accrued interest moves share amounts slightly. Other parties' transfers
// (fee shares minted to the vault's fee recipient) are left out; they aren't the user's money.
function compareWithServer(
  op: PreparedOperation,
  ours: Transfer[],
  user: Address,
  tokenOf: (a: string) => Token | undefined,
): Finding {
  const server = op.simulation?.transfers ?? []
  if (server.length === 0)
    return {
      id: "sim-server",
      status: "check",
      title: "Morpho's server sent no simulation to compare with",
    }
  const theirs: Transfer[] = []
  const unread: string[] = []
  for (const s of server) {
    const token = tokenOf(s.token.address)
    let value: bigint | undefined
    try {
      value = token ? parseUnits(s.amount.value, token.decimals) : undefined
    } catch {
      value = undefined
    }
    if (value === undefined) {
      unread.push(`${s.amount.value} ${s.amount.symbol}`)
      continue
    }
    theirs.push({ token: s.token.address, from: s.from, to: s.to, value })
  }
  if (unread.length > 0)
    return {
      id: "sim-server",
      status: "check",
      title: "Couldn't read all of Morpho's own simulation",
      detail: `Unreadable transfers: ${unread.join("; ")}.`,
    }
  const a = netFlows(ours, user)
  const b = netFlows(theirs, user)
  const diffs: string[] = []
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k) ?? 0n
    const y = b.get(k) ?? 0n
    if (close(x, y)) continue
    const t = tokenOf(k)
    diffs.push(`ours ${label(t, k, x)}, Morpho's ${label(t, k, y)}`)
  }
  return diffs.length === 0
    ? {
        id: "sim-server",
        status: "pass",
        title: "Matches Morpho's own simulation for your wallet",
      }
    : {
        id: "sim-server",
        status: "check",
        title: "Differs from Morpho's own simulation for your wallet",
        detail: diffs.join("; "),
      }
}

// An amount in a token we may not have read.
const label = (t: Token | undefined, addr: string, v: bigint) =>
  t ? fmt(v, t) : `${v} of token ${short(addr)}`

const abs = (v: bigint) => (v < 0n ? -v : v)
const close = (a: bigint, b: bigint) => {
  // biome-ignore lint/complexity/useMathMinMax: bigint, Math.max doesn't take it
  const m = abs(a) > abs(b) ? abs(a) : abs(b)
  return m === 0n || abs(a - b) * 10_000n <= m
}

// A deposit's maxSharePriceE27 against the price our simulation paid (assets that reached the vault
// per share the user got; a referral fee never reaches the vault): how far the price could move
// before the bundle reverts.
function priceProtection(
  intent: Intent,
  op: PreparedOperation,
  transfers: Transfer[],
): Finding | undefined {
  const bundle = op.transactions
    .map((tx) => decodeCall(tx))
    .find(
      (d) => d.kind === "bundle" && typeof d.args.maxSharePriceE27 === "bigint",
    )
  const asset = intent.moves[0]?.token
  if (bundle?.kind !== "bundle" || !intent.vault || !asset) return undefined
  const max = bundle.args.maxSharePriceE27 as bigint
  const vault = intent.vault
  const sum = (f: (t: Transfer) => boolean) =>
    transfers.filter(f).reduce((a, t) => a + t.value, 0n)
  const assets = sum(
    (t) => sameAddress(t.token, asset.address) && sameAddress(t.to, vault),
  )
  const shares = sum(
    (t) => sameAddress(t.token, vault) && sameAddress(t.to, intent.user),
  )
  if (assets <= 0n || shares <= 0n) return undefined
  if (max === maxUint256)
    return {
      id: "price",
      status: "check",
      title: "No limit on the share price",
      detail: "The deposit would go through at any price.",
    }
  const paid = (assets * 10n ** 27n) / shares
  const bps = ((max - paid) * 10_000n) / paid
  const pct = `${(Number(bps) / 100).toFixed(2)}%`
  return bps <= 100n
    ? {
        id: "price",
        status: "pass",
        title: `Reverts if the share price rises more than ${pct}`,
      }
    : {
        id: "price",
        status: "check",
        title: `Allows a share price ${pct} above the simulated one`,
        detail:
          "The deposit would still go through if the price moved that far.",
      }
}

// A deposit: every unit of the asset that leaves the wallet must arrive in the vault. Anything else
// the asset is sent to on the way (a fee, a stranger) is named. Then where the vault moves it on:
// to a Morpho contract (Morpho Blue) is its normal allocation; anywhere else is CHECK, since a
// vault V2 may route through adapters we don't model. Independent of Morpho's simulation.
function reachesVault(
  intent: Intent,
  transfers: Transfer[],
  tokenOf: (a: string) => Token | undefined,
): Finding[] {
  const asset = intent.moves[0]
  const vault = intent.vault
  if (!vault || !asset || asset.direction !== "out") return []
  const ofAsset = transfers.filter((t) =>
    sameAddress(t.token, asset.token.address),
  )
  const sent = ofAsset
    .filter((t) => sameAddress(t.from, intent.user))
    .reduce((a, t) => a + t.value, 0n)
  const arrived = ofAsset
    .filter((t) => sameAddress(t.to, vault))
    .reduce((a, t) => a + t.value, 0n)
  if (sent === 0n) return []
  const out: Finding[] = []
  if (arrived >= sent)
    out.push({
      id: "sim-vault",
      status: "pass",
      title: `All ${fmt(sent, asset.token)} reach the vault`,
    })
  else {
    // Who else received the asset, other than the vault and the vault's own onward moves.
    const elsewhere = ofAsset.filter(
      (t) =>
        !sameAddress(t.to, vault) &&
        !sameAddress(t.from, vault) &&
        !sameAddress(t.to, intent.user) &&
        !sameAddress(t.from, intent.user),
    )
    out.push({
      id: "sim-vault",
      status: "stop",
      title: `Only ${fmt(arrived, asset.token)} of your ${fmt(sent, asset.token)} reach the vault`,
      detail: elsewhere.length
        ? elsewhere
            .map(
              (t) =>
                `${label(tokenOf(t.token), t.token, t.value)} goes to ${short(t.to)}`,
            )
            .join("; ")
        : undefined,
    })
  }
  const onward = new Map<string, { to: Address; value: bigint }>()
  for (const t of ofAsset)
    if (
      sameAddress(t.from, vault) &&
      !sameAddress(t.to, intent.user) &&
      !contractName(intent.chainId, t.to)
    ) {
      const k = t.to.toLowerCase()
      onward.set(k, { to: t.to, value: (onward.get(k)?.value ?? 0n) + t.value })
    }
  for (const { to, value } of onward.values())
    out.push({
      id: "sim-vault",
      status: "check",
      title: `The vault moves ${fmt(value, asset.token)} on to ${short(to)}`,
      detail:
        "Not a Morpho contract we know; it may be the vault's own allocation.",
    })
  return out
}
