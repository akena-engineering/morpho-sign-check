// Runs every check on a saved fixture against the live chain.
//   pnpm check-fixture -- eth-deposit-v1

import { envRpcs } from "../src/chain/env"
import { checkOperation } from "../src/check"
import { fixture } from "../src/core/testing"

const name = process.argv.slice(2).find((a) => a !== "--") ?? "eth-deposit-v1"
const { tool, args, op } = fixture(name)
const rpcs = envRpcs()
const r = await checkOperation(tool, args, op, { rpcs })
console.log(name, r.verdict)
for (const f of r.findings)
  console.log(
    ` ${f.status.padEnd(5)} ${f.call === undefined ? " " : f.call + 1} ${f.title}${f.detail ? `  | ${f.detail}` : ""}`,
  )
