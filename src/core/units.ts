import { formatUnits } from "viem"
import type { Token } from "./intent"

// "100 USDC", "82.8213 steakUSDC": at most 4 decimals, so 18-decimal share amounts stay readable.
// Exact comparisons happen on base units before anything is formatted.
export function formatAmount(v: bigint, t: Token): string {
  const [whole, frac = ""] = formatUnits(v, t.decimals).split(".")
  const cut = frac.slice(0, 4).replace(/0+$/, "")
  return `${whole}${cut ? `.${cut}` : ""} ${t.symbol}`
}
