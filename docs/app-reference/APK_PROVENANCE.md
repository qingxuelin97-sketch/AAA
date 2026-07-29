# APK reference provenance

The selected first-party UI assets in `client/public/reference-lottie/` and
`client/src/assets/app-reference/` were copied verbatim from the authorized
Android APK recorded in `apk-provenance.json`. They are approved migration
inputs for AAA, and their original APK paths and SHA-256 values remain pinned.

The migration explicitly excludes the Catbox logo, Catbox name, Catbox-specific
brand copy, marketing artwork, vendor SDKs, native libraries, and vendor package
code. The raw APK, DEX payloads, and full resource extraction stay outside Git.
Rebuild the selected assets and indexes with:

```powershell
python scripts/extract-maoxiang-apk-reference.py --repo . --output ../maoxiang-reference
```

The command reads the APK in place and writes analytical output to `../maoxiang-reference/`; use an explicitly supplied `--output` path for another destination.
