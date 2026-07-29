# App reference migration

This App-only layer was migrated from an authorized Android reference build
and then adapted to the existing React + Capacitor shell. The original
artifact, extraction output, and binary dependencies stay outside this
repository. The reproducibility ledger is kept in the workspace analysis
directory (outside the Git checkout).

## Reuse / port boundary

| Reference material | AAA treatment |
| --- | --- |
| Media-first role cards, action-rail ordering, story pacing | Ported into the existing Discover flow |
| Double-tap like and message long-press timing | Sanitized into `client/src/appReference.js` |
| Chat message action order and transient sheets | Preserved through existing React handlers |
| Android XML/vector/animation geometry that could be recovered | Re-expressed as App-scoped CSS and React markup |
| Android activities, fragments, system services, native binaries | Rewritten behind the existing Capacitor boundaries or excluded |
| Vendor SDKs, package namespaces, logos, names, and marketing artwork | Excluded from the product and build output |

The reference values are behavior data, not a runtime dependency. Web
fallback markup and server APIs remain unchanged.
