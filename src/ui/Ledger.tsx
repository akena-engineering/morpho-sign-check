import type { Scenario } from "../data/scenarios"

const NO_CHANGES = {
  ok: "Nothing would move.",
  reverted: "The calls revert in our simulation.",
  unavailable: "Simulation unavailable.",
} as const

// "Your wallet after": the user's net token changes in our own simulation.
export function Ledger({ wallet }: { wallet: Scenario["wallet"] }) {
  return (
    <section className="ledger" id="ledger" aria-labelledby="ledger-title">
      <h2 id="ledger-title" className="label">
        Your wallet after
      </h2>
      {wallet.changes.length > 0 ? (
        <dl className="ledger-rows">
          {wallet.changes.map((c) => (
            <div key={c.symbol} className={`ledger-${c.direction}`}>
              <dt className="ledger-amount">{c.amount}</dt>
              <dd className="ledger-symbol">{c.symbol}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="ledger-none">{NO_CHANGES[wallet.sim]}</p>
      )}
      {wallet.note && <p className="ledger-note">{wallet.note}</p>}
    </section>
  )
}
