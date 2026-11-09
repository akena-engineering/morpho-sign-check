import type { Finding, Verdict } from "./checks"

const MARK: Record<Finding["status"], string> = {
  pass: "✓",
  check: "!",
  stop: "✗",
  note: "·",
}
const HEADLINE: Record<Verdict, string> = {
  PASS: "PASS: no mismatch found in any check",
  CHECK: "CHECK: some lines need your review before signing",
  STOP: "STOP: don't sign these calls",
}

export const BYLINE =
  "Sign Check by Akena: an independent check, not by Morpho."

// Plain-text report appended to an MCP result, for the agent and the user.
export function report(r: { verdict: Verdict; findings: Finding[] }): string {
  const order: Finding["status"][] = ["stop", "check", "pass", "note"]
  const lines = [...r.findings]
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
    .map((f) => {
      const where = f.call === undefined ? "" : ` (call ${f.call + 1})`
      const detail = f.detail ? `: ${f.detail}` : ""
      return `${MARK[f.status]} ${f.title}${where}${detail}`
    })
  return [BYLINE, `Verdict: ${HEADLINE[r.verdict]}`, ...lines].join("\n")
}
