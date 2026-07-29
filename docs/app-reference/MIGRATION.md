# App reference migration

This App-only layer was migrated from an authorized Android reference build
and then adapted to the existing React + Capacitor shell. The original
artifact, extraction output, and binary dependencies stay outside this
repository. The reproducibility ledger is kept in the workspace analysis
directory (outside the Git checkout).

## Delivery status and gate

Earlier commits were **preflight**: they recorded the intended screen and
interaction boundary, but did not establish a reproducible APK asset trail.
The current migration is gated by `client/app-test.mjs`,
`client/apk-provenance-test.mjs`, and `docs/app-reference/apk-provenance.json`:
it pins the APK SHA-256 and version, checks the allowlisted asset hashes,
locks the chat action order, validates the six-surface class/layout/component
mapping, and rejects APK/native/vendor artifact types and vendor namespaces
from runtime source. The raw APK and DEX payloads remain outside the checkout.

## Reuse / port boundary

| Reference material | AAA treatment |
| --- | --- |
| Media-first role cards, action-rail ordering, story pacing | **Port** into the existing Discover flow |
| Double-tap like, message long-press timing, and chat action ordering | **Reuse as sanitized behavior contracts** in `client/src/appReference.js` |
| Seven allowlisted first-party Lottie JSON assets | **Reuse** in AAA, pinned by `apk-provenance.json` |
| Default chat action JSON | **Reuse verbatim** in `client/src/assets/app-reference/`, with its APK path and hash pinned |
| Selected compiled Android layouts | **Decode and index** outside Git as geometry evidence; **rewrite** into AAA components |
| Target Activity/Fragment classes | **Index** names and source DEX only; **port behavior**, never copy DEX payloads |
| Android XML/vector/animation geometry that could be recovered | **Rewrite** as App-scoped CSS and React markup |
| Android activities, fragments, system services, native binaries | **Exclude** or **rewrite** behind existing Capacitor boundaries |
| Vendor SDKs and package namespaces; Catbox logo, name, brand copy, and marketing artwork | **Exclude** from runtime source and build output |

The reference values are behavior data, not a runtime dependency. Web
fallback markup and server APIs remain unchanged.
