import type { ArgView, Scenario } from "../data/scenarios"
import { elideDigits } from "./format"

// "You'd sign": every prepared call, decoded, each argument read back against the request. An
// argument that a check cleared for a term of the request wears that term's mark; Morpho's
// plumbing stays quiet; anything nobody asked for breaks the pattern. Annotations appear one by one.
export function ReadBack(props: { scenario: Scenario; shown: number }) {
  const terms = new Map(
    props.scenario.requestParts.flatMap((p) =>
      p.term ? [[p.term, p.text]] : [],
    ),
  )
  let index = 0
  return (
    <section className="sign" aria-labelledby="sign-title">
      <h2 id="sign-title" className="label">
        You'd sign {props.scenario.calls.length}{" "}
        {props.scenario.calls.length === 1 ? "call" : "calls"}
        {props.scenario.tampered && (
          <span className="label-aside">changed on the way</span>
        )}
      </h2>
      <p className="cols" aria-hidden="true">
        <span>In the transaction</span>
        <span>You asked</span>
      </p>
      <ol className="calls">
        {props.scenario.calls.map((c, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: calls are ordered and never reordered
            key={i}
            className="call"
          >
            <p className="call-head">
              <span className="call-n">{i + 1}</span>
              <code className="call-fn">
                {c.target}
                <span className="call-dot">.</span>
                {c.fn}
              </code>
              {c.added ? (
                <span className="call-added">
                  Added by Sign Check for the simulation
                </span>
              ) : (
                c.description && (
                  <span className="call-said">
                    Morpho's note: <q>{elideDigits(c.description)}</q>
                  </span>
                )
              )}
            </p>
            <dl className="args">
              {c.args.map((a) => (
                <Arg
                  key={a.name}
                  arg={a}
                  term={terms.get(a.link)}
                  shown={index++ < props.shown}
                />
              ))}
            </dl>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Arg(props: { arg: ArgView; term?: string; shown: boolean }) {
  const { arg: a, term } = props
  const kind = term ? "linked" : a.link === "unasked" ? "unasked" : "plumbing"
  return (
    <div
      className={`arg arg-${kind} is-${a.status}${props.shown ? " shown" : ""}`}
      data-link={a.link}
    >
      <dt>{a.name}</dt>
      <dd className="arg-value">
        <Value text={a.value} className="value" />
        {a.changed && <Value text={a.changed} className="was" strike />}
      </dd>
      <dd className="arg-read" aria-hidden={!props.shown}>
        <Read kind={kind} arg={a} term={term} />
      </dd>
    </div>
  )
}

function Read(props: { kind: string; arg: ArgView; term?: string }) {
  const { kind, arg: a, term } = props
  if (kind === "unasked")
    return (
      <span className="flag" title={a.note}>
        Not in your request
      </span>
    )
  if (term && a.status === "unchecked")
    return <span className="read read-unchecked">Not checked</span>
  if (term && a.status === "pass")
    return <span className="read read-term">{term}</span>
  return <span className="read">{a.note ?? "Morpho plumbing"}</span>
}

// Addresses in mono, words and amounts in sans.
function Value(props: { text: string; className: string; strike?: boolean }) {
  const parts = props.text.split(/(0x[0-9a-fA-F]+…[0-9a-fA-F]+)/)
  const body = parts.map((p, i) =>
    p.startsWith("0x") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: fixed split of one string
      <code key={i}>{p}</code>
    ) : (
      p
    ),
  )
  return props.strike ? (
    <s className={props.className}>{body}</s>
  ) : (
    <span className={props.className}>{body}</span>
  )
}
