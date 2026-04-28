# BYOK Windows CLI Tail Fixes (2026-04-24)

## Scope

- [x] Fix false `cli-missing` verification when the CLI catalog probe already succeeded
- [x] Classify Windows CLI failures (`missing-platform-binary` / `cli-not-found` / `probe-timeout`)
- [x] Treat Windows `--version` timeout as soft-preflight in model probing
- [x] Show targeted warnings after BYOK save/import
- [x] Show targeted conversation errors when session start fails for these Windows cases
- [x] Add richer logs for CLI diagnostics and BYOK verifier resolution
- [x] Add/adjust unit tests
- [x] Run validators
- [x] Build `win64` fast package and record artifact hash

## Validation

- `bun run lint:fix`
- `bun run format`
- `bun run i18n:types`
- `node scripts/check-i18n.js`
- `bunx tsc --noEmit`
- `bun run test`

## Build

- Direct GitHub releases HEAD check returned `200`; electron-builder caches (`nsis`, `winCodeSign`, `wine`) were present locally.
- Fast build command: `bun run build-win:x64:fast`
- Artifact: `out/智能体工厂-0.1.8-win-x64.exe`
  - SHA-256: `82836fb1e6534d4b373a7d4a74dc7ee6c945023d5321c05c7a3341c88d50e032`
- Artifact: `out/智能体工厂-0.1.8-win-x64.zip`
  - SHA-256: `db6e0ca596cb6c0983828a3f4c7d3319630b214be547c2541f07ae06595db732`
- Embedded installer payload validation:
  - temporary payload extraction validated with `file` => `7-zip archive data, version 0.4`
