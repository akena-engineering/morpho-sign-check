import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose"
import { z } from "zod"
import type { Finding } from "./checks"

export const JWKS_URL =
  "https://api.morpho.org/.well-known/morpho-actions-jwks.json"

const Jwks = z.object({
  keys: z.array(z.looseObject({ kty: z.string(), kid: z.string().optional() })),
})
export const parseJwks = (raw: unknown) =>
  Jwks.parse(raw) as unknown as JSONWebKeySet

// Morpho's docs: each prepare result carries `action_proof`, which "Production clients must verify
// … (ES256 only)". The claim format isn't public, so this checks the signature, the key and expiry
// only, and says so: a valid proof is CHECK until its claims are bound. ponytail: bind the claims to the calls once a real proof has been seen.
export async function proofCheck(
  proof: string | undefined,
  jwks: JSONWebKeySet,
): Promise<Finding> {
  if (!proof)
    return {
      id: "proof",
      status: "note",
      title: "No action_proof in this response",
      detail:
        "Morpho's docs ask clients to verify it; this server version doesn't send one yet.",
    }
  try {
    const { protectedHeader } = await jwtVerify(
      proof,
      createLocalJWKSet(jwks),
      { algorithms: ["ES256"], requiredClaims: ["exp"] },
    )
    return {
      id: "proof",
      // Signed, but nothing ties the claims to these calls yet: never a PASS on its own.
      status: "check",
      title:
        `action_proof signed by Morpho's key ${protectedHeader.kid ?? ""}`.trim(),
      detail:
        "Signature and expiry checked; what the claims cover isn't checked yet.",
    }
  } catch (e) {
    return {
      id: "proof",
      status: "stop",
      title: "action_proof doesn't verify against Morpho's key",
      detail: (e as Error).message,
    }
  }
}
