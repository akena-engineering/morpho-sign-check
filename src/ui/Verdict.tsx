import {
  type FindingView,
  GROUPS,
  groupOf,
  type Scenario,
} from "../data/scenarios"
import { Checks } from "./Checks"
import { dayTime, VERDICT_TEXT } from "./format"

const RANK = { pass: 0, note: 1, check: 2, stop: 3 } as const
type Lower = "pass" | "check" | "stop"
// "13 of 13 checks pass", "1 of 15 checks needs review", "2 of 9 checks say stop".
const COUNTED: Record<Lower, [string, string]> = {
  pass: ["check passes", "checks pass"],
  check: ["check needs review", "checks need review"],
  stop: ["check says stop", "checks say stop"],
}
const MARK = { pass: "✓", note: "i", check: "!", stop: "×" } as const

// The stamp, one plain sentence and the count. Hidden (aria-hidden) until the read-back has drawn in.
export function Verdict(props: {
  scenario: Scenario
  checkedAt: string
  done: boolean
}) {
  const { verdict, findings } = props.scenario
  const counted = findings.filter((f) => f.status !== "note")
  const status = verdict.toLowerCase() as Lower
  const n = counted.filter((f) => f.status === status).length
  return (
    <section
      className={`verdict${props.done ? " landed" : ""}`}
      aria-labelledby="verdict-title"
      aria-hidden={!props.done}
    >
      <h2 id="verdict-title" className="visually-hidden">
        Verdict
      </h2>
      {props.scenario.tampered && (
        <p className="demo-tag">
          Demo: changed by Sign Check, not sent by Morpho
        </p>
      )}
      <div className={`stamp stamp-${status}`} id="verdict">
        <span className="stamp-word">{verdict}</span>
        <span className="stamp-meta">{dayTime(props.checkedAt)}</span>
      </div>
      {/* Both in one cell, so the rail already has the final height while it reads back. */}
      <p className={props.done ? "verdict-text" : "verdict-text pending"}>
        <span className="verdict-final">{VERDICT_TEXT[verdict]}</span>
        <span className="verdict-pending">Reading it back…</span>
      </p>
      <p className="verdict-count">
        <strong>
          {n} of {counted.length}
        </strong>{" "}
        {n === 1 ? COUNTED[status][0] : COUNTED[status][1]}
      </p>
    </section>
  )
}

// The parts of the check in one line each (Morpho's server only when it raised something), notes
// as a quiet footnote, then every check behind a disclosure. Inert until the verdict lands.
export function Summary(props: { findings: FindingView[]; done: boolean }) {
  const notes = props.findings.filter((f) => f.status === "note")
  const rows = GROUPS.map((g) => ({
    g,
    worst: worstOf(
      props.findings.filter(
        (f) => groupOf(f.id) === g.id && f.status !== "note",
      ),
    ),
  })).filter((r) => r.g.id !== "server" || r.worst)
  return (
    <section
      className={`summary${props.done ? " landed" : ""}`}
      aria-label="The checks"
      aria-hidden={!props.done}
      inert={!props.done}
    >
      <ul className="summary-lines">
        {rows.map(({ g, worst }) => {
          const status = worst?.status ?? "pass"
          return (
            <li key={g.id} className={`summary-line is-${status}`}>
              <span className="summary-mark" aria-hidden="true">
                {MARK[status]}
              </span>
              <span>
                <span className="summary-title">{g.title}</span>
                {worst ? worst.title : g.ok}
              </span>
            </li>
          )
        })}
      </ul>
      {notes.map((f) => (
        <p key={`${f.id}-${f.title}`} className="summary-note">
          Note: {f.title}
          {f.id === "server-warning" && f.detail ? `: ${f.detail}` : "."}
        </p>
      ))}
      <details className="all-checks">
        <summary>
          {/* Same count as the stamp; notes (e.g. the missing action_proof) aren't checks. */}
          All {props.findings.filter((f) => f.status !== "note").length} checks
          {props.findings.some((f) => f.status === "note") && " and notes"}
        </summary>
        <Checks findings={props.findings} />
      </details>
    </section>
  )
}

// The finding that most needs attention (the last of equals), or undefined when every one passes.
function worstOf(fs: FindingView[]) {
  const w = fs.reduce<FindingView | undefined>(
    (a, f) => (!a || RANK[f.status] >= RANK[a.status] ? f : a),
    undefined,
  )
  return w?.status === "pass" ? undefined : w
}
