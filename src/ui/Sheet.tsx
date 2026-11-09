import type { Scenario } from "../data/scenarios"
import { VERDICT_TEXT } from "./format"
import { Ledger } from "./Ledger"
import { ReadBack } from "./ReadBack"
import { Request } from "./Request"
import { useReveal } from "./useReveal"
import { Summary, Verdict } from "./Verdict"

// One example read top to bottom: the request, what you'd sign, and (in the rail on wide screens)
// your wallet after and the verdict. Remount per example (key) to replay the reveal.
export function Sheet(props: { scenario: Scenario; checkedAt: string }) {
  const s = props.scenario
  const args = s.calls.reduce((n, c) => n + c.args.length, 0)
  // Every argument's link, then two beats, then the stamp.
  const shown = useReveal(args + 2)
  const done = shown >= args + 2
  return (
    <div className="work">
      <article className="sheet">
        <Request scenario={s} />
        <ReadBack scenario={s} shown={shown} />
      </article>
      <aside className={done ? `rail is-${s.verdict.toLowerCase()}` : "rail"}>
        {/* One announcement per example, when the verdict is known. */}
        <p role="status" className="visually-hidden">
          {done ? `${s.label}: ${s.verdict}. ${VERDICT_TEXT[s.verdict]}` : ""}
        </p>
        <Verdict scenario={s} checkedAt={props.checkedAt} done={done} />
        <Ledger wallet={s.wallet} />
        <Summary findings={s.findings} done={done} />
      </aside>
    </div>
  )
}
