import { describe, expect, it } from "vitest"
import { latest } from "./latest"

describe("latest", () => {
  it("drops a check that finishes after the inputs changed", async () => {
    const l = latest()
    const seen: unknown[] = []
    let finish = (_: string) => {}
    const run = l.run(
      () => new Promise<string>((r) => (finish = r)),
      (r) => seen.push(r),
    )
    l.change()
    finish("old verdict")
    expect(await run).toBe(false)
    expect(seen).toEqual([])
  })

  it("keeps one that finishes on the same inputs, errors included", async () => {
    const l = latest()
    const seen: unknown[] = []
    expect(
      await l.run(
        async () => "PASS",
        (r) => seen.push(r),
      ),
    ).toBe(true)
    await l.run(
      async () => {
        throw new Error("rpc down")
      },
      (r) => seen.push(r.ok),
    )
    expect(seen).toEqual([{ ok: true, value: "PASS" }, false])
  })
})
