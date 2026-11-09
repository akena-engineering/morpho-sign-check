// Inputs have a revision; a run that started before the latest change is stale and its outcome is
// dropped, so a slow check never lands on inputs it didn't read.
export function latest() {
  let rev = 0
  return {
    change() {
      rev++
    },
    async run<T>(
      task: () => Promise<T>,
      done: (r: { ok: true; value: T } | { ok: false; error: unknown }) => void,
    ) {
      const at = rev
      let r: { ok: true; value: T } | { ok: false; error: unknown }
      try {
        r = { ok: true, value: await task() }
      } catch (error) {
        r = { ok: false, error }
      }
      if (at === rev) done(r)
      return at === rev
    },
  }
}
