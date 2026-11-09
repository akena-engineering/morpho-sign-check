import type { Scenario } from "../data/scenarios"

// The five examples as a docket: the two Morpho prepared, then the deposit changed three ways, then
// "Check your own" (id OWN).
export const OWN = "own"
type Item = { id: string; label: string; tampered: boolean }
export function Picker(props: {
  scenarios: Scenario[]
  current: string
  onPick: (id: string) => void
}) {
  const groups: { title: string; items: Item[] }[] = [
    {
      title: "Real responses from Morpho",
      items: props.scenarios.filter((s) => !s.tampered),
    },
    {
      title: "Changed on the way (demo)",
      items: props.scenarios.filter((s) => s.tampered),
    },
    {
      title: "Try it yourself",
      items: [{ id: OWN, label: "Check your own", tampered: false }],
    },
  ]
  let n = 0
  return (
    <nav className="docket" aria-label="Examples">
      {groups.map((g) => (
        <fieldset key={g.title} className="docket-group">
          <legend>{g.title}</legend>
          <div className="docket-items">
            {g.items.map((s) => (
              <button
                key={s.id}
                type="button"
                data-example={s.id}
                className={s.tampered ? "docket-item changed" : "docket-item"}
                aria-pressed={s.id === props.current}
                onClick={() => props.onPick(s.id)}
              >
                <span className="docket-n" aria-hidden="true">
                  {String(++n).padStart(2, "0")}
                </span>
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
    </nav>
  )
}
