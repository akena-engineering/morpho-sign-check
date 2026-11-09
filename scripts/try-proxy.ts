// Starts the proxy over stdio like an agent would, prepares one deposit, prints the check.
//   pnpm try-proxy [-- --tamper fee]
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CASES } from "./probe"

const extra = process.argv.slice(2).filter((a) => a !== "--")
const client = new Client({ name: "try-proxy", version: "0" })
await client.connect(
  new StdioClientTransport({
    command: "pnpm",
    args: ["--silent", "proxy", ...(extra.length ? ["--", ...extra] : [])],
    cwd: new URL("..", import.meta.url).pathname,
    stderr: "inherit",
  }),
)
const deposit = CASES.find((c) => c.name === "eth-deposit-v1")
if (!deposit) throw new Error("no eth-deposit-v1 case in scripts/probe.ts")
const tools = await client.listTools()
console.log(`${tools.tools.length} tools`)
const res = await client.callTool({
  name: deposit.tool,
  arguments: {
    ...deposit.args,
    context: "Testing an independent pre-signing check of a prepared deposit.",
    llm_model: "unknown",
  },
})
const content = res.content as { type: string; text?: string }[]
console.log(content.at(-1)?.text)
await client.close()
