# Findings (spike, 2026-11-05)

- **Server:** `https://mcp.morpho.org/` is `morpho-mcp@9f1652a`, with 52 tools, 27 of them `morpho_prepare_*`. It needs no key or account.
- **The live server differs from the docs.** Prepare tools take `chain`, `vaultAddress` or `marketId`, `userAddress` and a human-readable `amount`. They return a `PreparedOperation` (`summary`, `requirements`, `transactions[] {to, data, value, chainId, description}`, `outcome`, `simulation {transfers, postState}`, `warnings[] {level, code?, message}`). They return no `action_proof`, though the docs say each result carries one and that clients must verify it against `https://api.morpho.org/.well-known/morpho-actions-jwks.json` (live, ES256, kid `morpho-actions-attestor-prd-1`).
- **Deposit (Ethereum, Steakhouse USDC V1, 100 USDC):**
  - USDC `approve(vaultBundlesV1, 100000000)`, an exact amount.
  - `vaultBundlesV1Deposit(vault, assets, maxSharePriceE27, assetPermit, referralFeePct, referralFeeRecipient, deadline)` on `0x02912516…650B`. It has no receiver argument: shares go to the caller.
  - Both contracts are in `@morpho-org/morpho-ts@4.1.0` `addresses[1]`, and the ABI is verified on Sourcify (chains 1 and 8453).
- **Supply collateral and borrow (Ethereum, wstETH/USDC `0xb323…86cc`, 1 wstETH, 1 000 USDC):**
  - wstETH `approve(blueBundlesV1, 2^256-1)`: **unlimited**, while the deposit approves the exact amount.
  - Morpho Blue `setAuthorization(blueBundlesV1, true)`: the bundle may act on the user's Blue positions.
  - `0xb1268765` on `blueBundlesV1` `0x38B0…e6AD`.
  - The server's own simulation reverted because the example address holds no wstETH. It reports this as a warning with `level: "error"`, as documented, and estimates a health factor of 2.60.
- **Withdraw** for an address with no position returns `INVALID_INPUT` ("exceeds current vault liquidity"). It is not a prepared operation, so it isn't used.
- **Independent simulation works.** `eth_simulateV1` on an independent Ethereum RPC runs the deposit bundle from the user, with a state override that gives the user 100 USDC (FiatToken balance slot 9). The `Transfer` logs match the server's `simulation.transfers` exactly: user → bundle 100 USDC, bundle → vault, vault → Blue, and 87.18 steakUSDC minted to the user. The vault also mints fee shares to its fee recipient.
- **Tamper cases that fit the real calldata:** approval spender changed; vault changed; `referralFeePct`/`referralFeeRecipient` set to send a cut to a stranger; amount changed while the `description` still says the old one; an extra `transfer` call appended.
