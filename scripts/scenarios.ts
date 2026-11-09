// Builds public/data/scenarios.json for the page: the real prepared operations from
// src/core/fixtures, and the same deposit changed in one field, each run through every check on the
// live chain (ETH_RPC_URL from .env.local for Ethereum when set, otherwise a public node).
//   pnpm scenarios
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chainReader, clientFor } from "../src/chain/client"
import { envRpcs } from "../src/chain/env"
import { checkOperation } from "../src/check"
import { parseOperation } from "../src/core/operation"
import { TAMPERS, type TamperKind, tamper } from "../src/core/tamper"
import { scenarioView } from "../src/data/view"

const here = import.meta.dirname
const rpcs = envRpcs()
const read = chainReader(rpcs)

type Def = {
  id: string
  label: string
  // The request as the user typed it, with the terms the calls must carry out marked
  // "[100 USDC](asset)"; the ids are describe.ts's `Term`s.
  request: string
  fixture: string
  tamper?: TamperKind
}
const DEPOSIT = "Deposit [100 USDC](asset) into [Steakhouse USDC](vault)."
const DEFS: Def[] = [
  {
    id: "deposit",
    label: "Deposit",
    request: DEPOSIT,
    fixture: "eth-deposit-v1",
  },
  {
    id: "borrow",
    label: "Borrow",
    request:
      "Supply [1 wstETH](collateral) and borrow [1,000 USDC](loan) on the [wstETH / USDC](market) market.",
    fixture: "eth-collateral-borrow",
  },
  ...(["spender", "fee", "amount"] as const).map((k) => ({
    id: `deposit-${k}`,
    label: TAMPERS[k],
    request: DEPOSIT,
    fixture: "eth-deposit-v1",
    tamper: k,
  })),
]

function load(name: string) {
  const raw = JSON.parse(
    readFileSync(join(here, "../src/core/fixtures", `${name}.json`), "utf8"),
  )
  return {
    tool: raw.tool as string,
    args: raw.args as Record<string, unknown>,
    server: raw.server as string,
    probedAt: raw.probedAt as string,
    op: parseOperation(raw.result),
  }
}

// The chain head when the checks start (each check reads the latest block, so this is approximate).
const startBlock = await clientFor(1, rpcs).getBlockNumber()
const scenarios = []
for (const d of DEFS) {
  const f = load(d.fixture)
  const op = d.tamper ? tamper(f.op, d.tamper) : f.op
  const report = await checkOperation(f.tool, f.args, op, { rpcs })
  scenarios.push(
    await scenarioView({
      id: d.id,
      label: d.label,
      request: d.request,
      tool: f.tool,
      server: f.server,
      probedAt: f.probedAt,
      op,
      report,
      read,
      original: d.tamper ? f.op : undefined,
    }),
  )
  console.log(d.id, report.verdict)
}
writeFileSync(
  join(here, "../public/data/scenarios.json"),
  `${JSON.stringify({ checkedAt: new Date().toISOString(), block: Number(startBlock), scenarios }, null, 2)}\n`,
)
