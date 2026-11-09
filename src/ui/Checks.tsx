import { type FindingView, GROUPS, groupOf } from "../data/scenarios"

const LABEL = {
  pass: "Pass",
  check: "Check",
  stop: "Stop",
  note: "Note",
} as const

// Every check, grouped: the full record behind the verdict.
export function Checks({ findings }: { findings: FindingView[] }) {
  return GROUPS.map((g) => {
    const items = findings.filter((f) => groupOf(f.id) === g.id)
    if (items.length === 0) return null
    return (
      <div key={g.id} className="check-group">
        <h3>{g.title}</h3>
        <p className="check-lead">{g.lead}</p>
        <ul>
          {items.map((f) => (
            <li
              key={`${f.id}-${f.call ?? ""}-${f.title}`}
              className={`line line-${f.status}`}
            >
              <span className="badge">{LABEL[f.status]}</span>
              <span className="what">
                {f.title}
                {f.call !== undefined && (
                  <span className="which">call {f.call + 1}</span>
                )}
                {f.detail && <span className="detail">{f.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  })
}
