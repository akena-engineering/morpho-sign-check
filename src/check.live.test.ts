import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { CASES } from "../scripts/probe"
import { envRpcs } from "./chain/env"
import { checkOperation } from "./check"
import { findPayload } from "./core/payload"

// End to end on the real server and chain: `pnpm test:live`. Prepares each example fresh from
// Morpho's MCP server (its deadlines expire after about two hours), then runs every check.
const rpcs = envRpcs()
const client = new Client({ name: "sign-check-live-test", version: "0" })
beforeAll(() =>
  client.connect(
    new StreamableHTTPClientTransport(new URL("https://mcp.morpho.org/")),
  ),
)
afterAll(() => client.close())

describe("live", () => {
  it.each([
    ["eth-deposit-v1", "PASS"],
    ["eth-collateral-borrow", "CHECK"],
    ["base-deposit-v2", "STOP"],
  ])(
    "%s → %s",
    async (name, expected) => {
      const c = CASES.find((x) => x.name === name)
      if (!c) throw new Error(`no case ${name}`)
      const args = {
        ...c.args,
        context: "Testing an independent pre-signing check.",
        llm_model: "unknown",
      }
      const res = await client.callTool({ name: c.tool, arguments: args })
      const payload = findPayload(
        res.content as { type: string; text?: string }[],
      )
      if (payload.kind !== "one")
        throw new Error(`no operation: ${JSON.stringify(payload)}`)
      const r = await checkOperation(c.tool, c.args, payload.op, { rpcs })
      expect(
        r.verdict,
        r.findings.map((f) => `${f.status} ${f.title}`).join("\n"),
      ).toBe(expected)
    },
    180_000,
  )
})
