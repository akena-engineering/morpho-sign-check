import type { Scenario } from "../data/scenarios"

// The user's own words, with the terms the calls must carry out marked in the signature ink.
export function Request({ scenario }: { scenario: Scenario }) {
  return (
    <section className="ask" aria-labelledby="ask-title">
      <h2 id="ask-title" className="label">
        You asked the agent
      </h2>
      <p className="request">
        {scenario.requestParts.map((p, i) =>
          p.term ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed sentence, never reordered
            <mark key={i} className="term" data-term={p.term}>
              {p.text}
            </mark>
          ) : (
            p.text
          ),
        )}
      </p>
    </section>
  )
}
