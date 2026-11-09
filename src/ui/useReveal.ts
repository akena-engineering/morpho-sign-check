import { useEffect, useState } from "react"

const STEP_MS = 140

// Counts up to `total` one step at a time, so the read-back draws in link by link before the verdict
// lands. Starts at `total` with reduced motion. Remount (key) to replay.
export function useReveal(total: number) {
  const [shown, setShown] = useState(() => (reduced() ? total : 0))
  useEffect(() => {
    if (shown >= total) return
    const t = setTimeout(() => setShown((n) => n + 1), STEP_MS)
    return () => clearTimeout(t)
  }, [shown, total])
  return shown
}

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
