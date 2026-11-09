const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")

// "5 Nov 2026, 10:42 UTC": fixed format, same in every locale.
export function dayTime(iso: string) {
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`
}

export const VERDICT_TEXT = {
  PASS: "No mismatch found in any check.",
  CHECK: "Some lines need your review before you sign.",
  STOP: "Don't sign these calls.",
} as const

// Morpho's own call descriptions can carry a raw uint256 (an unlimited approval is 78 digits).
export const elideDigits = (s: string) =>
  s.replace(/\d{16,}/g, (d) => `${d.slice(0, 4)}…${d.slice(-4)}`)
