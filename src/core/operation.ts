import type { Address, Hex } from "viem"
import { z } from "zod"

// What a `morpho_prepare_*` tool of morpho-mcp@9f1652a returns (docs/findings.md). Only the fields
// the checks read are strict; everything else passes through.
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/) as unknown as z.ZodType<Address>
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/) as unknown as z.ZodType<Hex>

export const PreparedTx = z.object({
  to: address,
  data: hex,
  value: z.string(),
  chainId: z.string(),
  description: z.string().default(""),
})
export type PreparedTx = z.infer<typeof PreparedTx>

export const ServerTransfer = z.object({
  token: z.object({ address, symbol: z.string() }),
  from: address,
  to: address,
  amount: z.object({ symbol: z.string(), value: z.string() }),
})
export type ServerTransfer = z.infer<typeof ServerTransfer>

export const Warning = z.object({
  level: z.string(),
  code: z.string().optional(),
  message: z.string(),
})
export type Warning = z.infer<typeof Warning>

export const PreparedOperation = z.looseObject({
  operation: z.string(),
  chain: z.string(),
  summary: z.string().default(""),
  transactions: z.array(PreparedTx),
  simulation: z
    .looseObject({ transfers: z.array(ServerTransfer).default([]) })
    .optional(),
  warnings: z.array(Warning).default([]),
  // Documented for the Actions API, not sent by morpho-mcp@9f1652a.
  action_proof: z.string().optional(),
})
export type PreparedOperation = z.infer<typeof PreparedOperation>

export const parseOperation = (raw: unknown) => PreparedOperation.parse(raw)

export const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  base: 8453,
}
