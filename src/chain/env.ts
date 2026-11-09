import type { Rpcs } from "./client"

// Node only (proxy, scripts, live tests): ETH_RPC_URL from .env.local, any Ethereum RPC that serves
// eth_simulateV1. Unset, the keyless public node in client.ts is used.
export const envRpcs = (): Rpcs =>
  process.env.ETH_RPC_URL ? { 1: process.env.ETH_RPC_URL } : {}
