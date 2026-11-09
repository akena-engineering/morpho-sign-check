// Calls Morpho's public MCP server and saves real prepare results as test fixtures
// (src/core/fixtures/<name>.json). Read-only: prepare tools return unsigned calls, and nothing is
// signed or sent.
//   pnpm probe                 every case
//   pnpm probe -- eth-deposit  one case
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const MCP = "https://mcp.morpho.org/"
const OUT = join(import.meta.dirname, "../src/core/fixtures")
// An ordinary wallet that holds wstETH and USDC on Ethereum (found from recent wstETH transfers on
// 2026-11-05). Morpho's server simulates with real balances and errors for an empty wallet, so the
// examples need a funded one. Only ever shown shortened; nothing is signed or sent.
const USER = "0x6cBecB6916B3085690eD8BE0402239E53aB5E986"
const CONTEXT =
  "Preparing an example operation to test an independent pre-signing check of unsigned transactions."

export type Case = { name: string; tool: string; args: Record<string, unknown> }

export const CASES: Case[] = [
  {
    name: "eth-deposit-v1",
    tool: "morpho_prepare_deposit",
    args: {
      chain: "ethereum",
      vaultAddress: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
      userAddress: USER,
      amount: "100",
    },
  },
  {
    name: "eth-collateral-borrow",
    tool: "morpho_prepare_supply_collateral_and_borrow",
    args: {
      chain: "ethereum",
      // wstETH / USDC, the largest such market on Ethereum on 2026-11-05.
      marketId:
        "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc",
      userAddress: USER,
      collateralAmount: "1",
      borrowAmount: "1000",
    },
  },
  {
    name: "base-deposit-v2",
    tool: "morpho_prepare_deposit",
    args: {
      chain: "base",
      vaultAddress: "0xbeef0786756810478b88982DE00F3CD7fdB8e7c7",
      userAddress: USER,
      amount: "100",
    },
  },
]

async function main() {
  const only = process.argv.slice(2).filter((a) => a !== "--")
  const client = new Client({ name: "akena-sign-check-probe", version: "0" })
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP)))
  const server = client.getServerVersion()
  mkdirSync(OUT, { recursive: true })
  for (const c of CASES.filter(
    (c) => only.length === 0 || only.includes(c.name),
  )) {
    const res = await client.callTool({
      name: c.tool,
      arguments: { ...c.args, context: CONTEXT, llm_model: "unknown" },
    })
    const content = res.content as { type: string; text?: string }[]
    const text = content.find((p) => p.type === "text")?.text ?? ""
    const fixture = {
      probedAt: new Date().toISOString(),
      server: `${server?.name}@${server?.version}`,
      tool: c.tool,
      args: c.args,
      isError: res.isError === true,
      result: text.startsWith("{") ? JSON.parse(text) : text,
    }
    writeFileSync(
      join(OUT, `${c.name}.json`),
      `${JSON.stringify(fixture, null, 2)}\n`,
    )
    console.log(
      c.name,
      fixture.isError ? "ERROR" : "ok",
      text.slice(0, 100).replace(/\s+/g, " "),
    )
  }
  await client.close()
}

// Only when run as a script; the live test imports CASES.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
