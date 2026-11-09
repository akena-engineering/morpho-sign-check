import { useEffect, useState } from "react"
import { PUBLIC_RPC } from "./chain/client"
import { short } from "./core/checks"
import { ScenarioFile as File, type ScenarioFile } from "./data/scenarios"
import { dayTime } from "./ui/format"
import { OWN, Picker } from "./ui/Picker"
import { Sheet } from "./ui/Sheet"
import { TryIt } from "./ui/TryIt"

export default function App() {
  const [data, setData] = useState<ScenarioFile>()
  const [error, setError] = useState<string>()
  const [id, setId] = useState("deposit")

  useEffect(() => {
    fetch("/data/scenarios.json")
      .then((r) => r.json())
      .then((j) => setData(File.parse(j)))
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error)
    return (
      <main className="page">
        <p className="empty">
          The examples didn't load ({error}). Run <code>pnpm scenarios</code>,
          then reload.
        </p>
      </main>
    )
  if (!data) return <main className="page" aria-busy="true" />

  const own = id === OWN
  const scenario = data.scenarios.find((s) => s.id === id) ?? data.scenarios[0]
  if (!scenario) return null

  return (
    <main className="page">
      <header className="top">
        <span className="brand">
          <span className="mark" aria-hidden="true" />
          Sign Check
          <span className="for">for Morpho MCP</span>
        </span>
        <span className="meta">
          Ethereum · block {data.block.toLocaleString("en-US")}
        </span>
      </header>

      <h1 className="lead">
        When an AI agent asks you to sign a Morpho transaction, Sign Check tells
        you in plain words whether it does exactly what you asked,{" "}
        <em>before you sign.</em>
      </h1>

      <Picker
        scenarios={data.scenarios}
        current={own ? OWN : scenario.id}
        onPick={setId}
      />

      {own ? (
        <TryIt />
      ) : (
        <Sheet
          key={scenario.id}
          scenario={scenario}
          checkedAt={data.checkedAt}
        />
      )}

      <footer className="foot">
        {own ? (
          <p>
            Your check runs in this browser: it decodes what you paste, reads
            Ethereum and simulates the calls on a public node (
            {PUBLIC_RPC[1]?.replace(/^https:\/\//, "")}). Nothing is signed or
            sent.
          </p>
        ) : (
          <p>
            Responses from {scenario.server} on {dayTime(scenario.probedAt)} for
            wallet {short(scenario.user)}; checks run on{" "}
            {dayTime(data.checkedAt)}. The changed examples are made by Sign
            Check to show what it catches; Morpho's server didn't send them.
          </p>
        )}
        <p>Built by Akena. Independent tool, not affiliated with Morpho.</p>
      </footer>
    </main>
  )
}
