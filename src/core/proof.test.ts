import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { describe, expect, it } from "vitest"
import { parseJwks, proofCheck } from "./proof"

async function keys() {
  const morpho = await generateKeyPair("ES256", { extractable: true })
  const other = await generateKeyPair("ES256")
  const jwk = { ...(await exportJWK(morpho.publicKey)), kid: "test-1" }
  return { morpho, other, jwks: parseJwks({ keys: [jwk] }) }
}
const sign = (key: CryptoKey, exp = "5m") =>
  new SignJWT({ calls: "0x" })
    .setProtectedHeader({ alg: "ES256", kid: "test-1" })
    .setExpirationTime(exp)
    .sign(key)

describe("proofCheck", () => {
  it("is a note when the server sends no proof", async () => {
    const { jwks } = await keys()
    expect((await proofCheck(undefined, jwks)).status).toBe("note")
  })

  it("is CHECK for a proof signed by the published key: its claims aren't bound yet", async () => {
    const { morpho, jwks } = await keys()
    const f = await proofCheck(await sign(morpho.privateKey), jwks)
    expect(f).toMatchObject({
      status: "check",
      title: "action_proof signed by Morpho's key test-1",
    })
  })

  it("stops on a proof without an expiry", async () => {
    const { morpho, jwks } = await keys()
    const noExp = await new SignJWT({ calls: "0x" })
      .setProtectedHeader({ alg: "ES256", kid: "test-1" })
      .sign(morpho.privateKey)
    expect((await proofCheck(noExp, jwks)).status).toBe("stop")
  })

  it("stops on a proof signed by another key, or expired", async () => {
    const { morpho, other, jwks } = await keys()
    expect((await proofCheck(await sign(other.privateKey), jwks)).status).toBe(
      "stop",
    )
    expect(
      (await proofCheck(await sign(morpho.privateKey, "-1m"), jwks)).status,
    ).toBe("stop")
  })
})
