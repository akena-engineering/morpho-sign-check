import { type FormEvent, useEffect, useId, useRef, useState } from "react"
import { planFor } from "../core/checks"
import {
  checkOwn,
  EXAMPLE_MARKET,
  EXAMPLE_TO,
  EXAMPLE_USER,
  EXAMPLE_VAULT,
  examples,
  InputError,
  type OwnRequest,
} from "../data/own"
import type { Scenario } from "../data/scenarios"
import { latest } from "./latest"
import { Sheet } from "./Sheet"

type Operation = OwnRequest["operation"]
const OPERATIONS: { id: Operation; label: string }[] = [
  { id: "deposit", label: "Deposit into a vault" },
  { id: "supply_collateral_and_borrow", label: "Supply collateral and borrow" },
]

// "Check your own": the request as a form, what you're asked to sign pasted below it, then the same
// sheet and rail as the examples, computed in this browser.
export function TryIt() {
  const id = useId()
  const [runs] = useState(latest)
  const [result, setResult] = useState<{ s: Scenario; n: number }>()
  // Any input change clears the shown result and outdates a running check.
  const touch = () => {
    runs.change()
    setResult(undefined)
  }
  const [operation, setOperation] = useInput<Operation>("deposit", touch)
  const [vault, setVault] = useInput<string>(EXAMPLE_VAULT, touch)
  const [amount, setAmount] = useInput("100", touch)
  const [marketId, setMarketId] = useInput<string>(EXAMPLE_MARKET, touch)
  const [collateral, setCollateral] = useInput("1", touch)
  const [borrow, setBorrow] = useInput("1000", touch)
  const [user, setUser] = useInput<string>(EXAMPLE_USER, touch)
  const [paste, setPaste] = useInput("", touch)
  const [to, setTo] = useInput("", touch)
  const [addApproval, setAddApproval] = useInput(true, touch)
  // The built-in example in the paste box, if any: which one, and Example A's call for B's diff.
  const [demo, setDemo] = useState<
    { which: "A" | "B" } & ReturnType<typeof examples>
  >()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string>()

  // Bring the verdict into view when it lands below the form.
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (result) sheet.current?.scrollIntoView({ block: "start" })
  }, [result])

  const hex = paste.trim().toLowerCase().startsWith("0x")
  const bundle = planFor(operation)?.contract

  // Fills in a built-in example with its deadline renewed to an hour from now.
  function example(which: "A" | "B") {
    const e = examples()
    setOperation("deposit")
    setVault(EXAMPLE_VAULT)
    setAmount("100")
    setUser(EXAMPLE_USER)
    setTo(EXAMPLE_TO)
    setAddApproval(true)
    setPaste(which === "A" ? e.a : e.b)
    setDemo({ which, ...e })
    setError(undefined)
  }
  const shown = demo && paste === (demo.which === "A" ? demo.a : demo.b)

  async function check(e: FormEvent) {
    e.preventDefault()
    setRunning(true)
    setError(undefined)
    setResult(undefined)
    const request: OwnRequest =
      operation === "deposit"
        ? { operation, vault, amount, user }
        : {
            operation,
            marketId,
            collateralAmount: collateral,
            borrowAmount: borrow,
            user,
          }
    const original = shown && demo.which === "B" ? demo.a : undefined
    await runs.run(
      () => checkOwn({ request, paste, to, addApproval, original }),
      (r) => {
        if (r.ok)
          setResult((p) => ({
            s: r.value,
            n: (p?.n ?? 0) + 1,
          }))
        else
          setError(
            r.error instanceof InputError
              ? r.error.message
              : `The check couldn't finish: ${r.error instanceof Error ? r.error.message : String(r.error)}`,
          )
      },
    )
    setRunning(false)
  }

  return (
    <>
      <form
        className="try"
        onSubmit={check}
        aria-labelledby={`${id}-title`}
        aria-busy={running}
      >
        <h2 id={`${id}-title`} className="visually-hidden">
          Check your own
        </h2>
        <section className="try-part">
          <fieldset className="try-ops">
            <legend className="label">You ask the agent to</legend>
            <div className="docket-items">
              {OPERATIONS.map((o) => (
                <label key={o.id} className="docket-item try-op">
                  <input
                    type="radio"
                    name={`${id}-op`}
                    value={o.id}
                    checked={operation === o.id}
                    onChange={() => setOperation(o.id)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
          {operation === "deposit" ? (
            <div className="try-fields">
              <Field
                label="Vault address"
                value={vault}
                onChange={setVault}
                mono
                wide
              />
              <Field label="Amount" value={amount} onChange={setAmount} />
            </div>
          ) : (
            <div className="try-fields">
              <Field
                label="Market id"
                value={marketId}
                onChange={setMarketId}
                mono
                wide
              />
              <Field
                label="Collateral amount"
                value={collateral}
                onChange={setCollateral}
              />
              <Field
                label="Borrow amount"
                value={borrow}
                onChange={setBorrow}
              />
            </div>
          )}
          <div className="try-fields">
            <Field
              label="Wallet that would sign"
              value={user}
              onChange={setUser}
              mono
              wide
              hint="The simulation uses this wallet's real balances on Ethereum. Nothing is signed or sent."
            />
          </div>
        </section>

        <section className="try-part">
          <div className="try-paste-head">
            <label className="label" htmlFor={`${id}-paste`}>
              Paste what you're asked to sign
            </label>
            <div className="try-examples">
              <button
                type="button"
                className="try-example"
                onClick={() => example("A")}
              >
                Example A{" "}
                <span>
                  as Morpho prepared it, deadline renewed for the demo
                </span>
              </button>
              <button
                type="button"
                className="try-example changed"
                onClick={() => example("B")}
              >
                Example B{" "}
                <span>changed on the way by Sign Check, deadline renewed</span>
              </button>
            </div>
          </div>
          <textarea
            id={`${id}-paste`}
            className="try-paste"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={5}
            spellCheck={false}
            aria-describedby={`${id}-paste-hint`}
            placeholder="0x6bbba4e0…"
          />
          <p id={`${id}-paste-hint`} className="try-hint">
            {shown
              ? `Example ${demo.which}: Morpho's real deposit call${demo.which === "B" ? " with a 5% referral fee to a stranger" : ""}, deadline renewed for the demo (Morpho's runs out about two hours after it's prepared).`
              : "One call's calldata (0x…), the full JSON a morpho_prepare_* tool returns, or a JSON list of {to, data, value} calls. Ethereum only."}
          </p>
          {hex && (
            <div className="try-hex">
              <Field
                label="Sent to"
                value={to}
                onChange={setTo}
                mono
                wide
                placeholder="Empty: Sign Check assumes Morpho's bundle contract and flags it"
              />
              <label className="try-check">
                <input
                  type="checkbox"
                  checked={addApproval}
                  onChange={(e) => setAddApproval(e.target.checked)}
                />
                <span>
                  Include the approval Morpho prepares with it
                  <span className="try-hint">
                    {operation === "deposit"
                      ? `Approve ${amount || "the amount"} of the vault's asset to ${bundle}.`
                      : `Approve ${collateral || "the amount"} of the collateral to ${bundle}, and let it borrow for you on Morpho Blue.`}{" "}
                    Added by Sign Check so the simulation can run; it's marked
                    in the read-back. Without it, a bundle call alone usually
                    reverts.
                  </span>
                </span>
              </label>
            </div>
          )}
          {error && (
            <p role="alert" className="try-error">
              {error}
            </p>
          )}
          <div className="try-go">
            <button type="submit" className="try-submit" disabled={running}>
              Check
            </button>
            {running && <span className="try-running">Reading it back…</span>}
          </div>
        </section>
      </form>

      <div ref={sheet} className="try-result">
        {result && (
          <Sheet
            key={result.n}
            scenario={result.s}
            checkedAt={result.s.probedAt}
          />
        )}
      </div>
    </>
  )
}

function useInput<T>(initial: T, touched: () => void) {
  const [v, set] = useState(initial)
  return [
    v,
    (next: T) => {
      touched()
      set(() => next)
    },
  ] as const
}

function Field(props: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
  wide?: boolean
  hint?: string
  placeholder?: string
}) {
  const id = useId()
  return (
    <div className={props.wide ? "try-field wide" : "try-field"}>
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={props.mono ? "mono" : undefined}
        spellCheck={false}
        autoComplete="off"
        placeholder={props.placeholder}
        aria-describedby={props.hint ? `${id}-hint` : undefined}
      />
      {props.hint && (
        <p id={`${id}-hint`} className="try-hint">
          {props.hint}
        </p>
      )}
    </div>
  )
}
