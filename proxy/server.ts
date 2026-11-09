// Morpho's MCP server, with a second opinion. A local stdio MCP server that lists Morpho's tools
// unchanged, forwards every call to https://mcp.morpho.org/, and appends Sign Check's verdict to each
// morpho_prepare_* result. It never signs or sends anything.
//   claude mcp add morpho-checked -- pnpm --dir <repo> --silent proxy
//   pnpm proxy -- --tamper fee     demo only: change each prepared result before checking it
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { chainReader } from "../src/chain/client"
import { envRpcs } from "../src/chain/env"
import { checkOperation } from "../src/check"
import { BYLINE, report } from "../src/core/format"
import { findPayload } from "../src/core/payload"
import { TAMPERS, type TamperKind, tamper } from "../src/core/tamper"

const MORPHO = "https://mcp.morpho.org/"
const flag = process.argv.indexOf("--tamper")
const tamperKind = flag > 0 ? (process.argv[flag + 1] as TamperKind) : undefined
if (tamperKind && !(tamperKind in TAMPERS))
  throw new Error(`--tamper takes one of: ${Object.keys(TAMPERS).join(", ")}`)
const rpcs = envRpcs()
// One reader for the whole session, so token symbols and decimals are read once.
const reader = chainReader(rpcs)

const upstream = new Client({ name: "akena-sign-check", version: "0.1.0" })
await upstream.connect(new StreamableHTTPClientTransport(new URL(MORPHO)))

const server = new Server(
  { name: "morpho-checked", version: "0.1.0" },
  {
    capabilities: { tools: {} },
    instructions: [
      upstream.getInstructions() ?? "",
      "Each morpho_prepare_* result ends with an independent check by Akena Sign Check (not by Morpho). Show its verdict to the user before they sign. On STOP, don't present the calls for signing.",
    ].join("\n\n"),
  },
)

server.setRequestHandler(ListToolsRequestSchema, (req) =>
  upstream.listTools(req.params),
)

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const res = await upstream.callTool(req.params)
  const name = req.params.name
  if (!name.startsWith("morpho_prepare_") || res.isError) return res
  const content = res.content as { type: string; text?: string }[]
  const out = [...content]
  const payload = findPayload(content, res.structuredContent)
  let text: string
  if (payload.kind !== "one")
    text = cantCheck(
      payload.kind === "none"
        ? "no prepared operation in this response"
        : payload.reason,
    )
  else
    try {
      const op = tamperKind ? tamper(payload.op, tamperKind) : payload.op
      if (tamperKind)
        out[payload.index] = {
          type: "text",
          text: JSON.stringify(
            { ...op, demo_tampered: TAMPERS[tamperKind] },
            null,
            2,
          ),
        }
      text = report(
        await checkOperation(name, req.params.arguments ?? {}, op, {
          rpcs,
          reader,
        }),
      )
    } catch (e) {
      // Never lose Morpho's answer because the check failed; say it didn't run.
      text = cantCheck((e as Error).message)
    }
  out.push({ type: "text", text })
  // A tampered text block would contradict Morpho's structuredContent; drop the latter.
  return tamperKind
    ? { ...res, content: out, structuredContent: undefined }
    : { ...res, content: out }
})

const cantCheck = (why: string) =>
  `${BYLINE}\nVerdict: CHECK: couldn't check this response (${why}). Check every call in your wallet before signing.`

await server.connect(new StdioServerTransport())
