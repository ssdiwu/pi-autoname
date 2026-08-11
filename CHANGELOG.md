# Changelog

All notable changes to `pi-autoname` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Controller-based lifecycle with cancellation, `session_info_changed` manual-name detection, `agent_settled` naming, and `session_shutdown` cleanup.
- Compaction-aware naming context: the latest summary is combined with the recent post-compaction message tail.
- User-message language detection, including Russian and CJK script handling.
- Optional `maxNameLength` and `ticketPattern` prefix extraction retained from the fork.

### Fixed

- Accept Unicode letter/number session names so locale-generated names are not limited to CJK and English.
- Preserve manual names by default (`respectManualName: true`); `/autoname` remains an explicit override.
- Infer naming language from user-authored natural language instead of a manual locale setting.
- Persist a single unambiguous task ticket from the first user message so later renames retain it without learning unrelated IDs from assistant replies, later discussion, legacy session names, or an untrusted model-generated prefix.

## [0.6.5] - 2026-06-18

### Added

- Extension lifecycle tests for `session_start`, `agent_settled`, cooldown gating, immediate out-of-band `/name` detection, and current-session JSONL diagnostics.
- `readSessionFileDiagnostics()` helper to inspect the active session file's latest `session_info` and `pi-autoname-state` entries during debug runs.

### Changed

- Test scripts now use Vitest's `threads` pool so `npm test` works reliably in environments where forked workers fail to boot.

## [0.6.2] - 2026-06-08

### Fixed

- Normalize `package.json` repository metadata to the standard Git URL format expected by npm.

## [0.6.1] - 2026-06-08

### Changed

- Refresh README hero section with a cover image, tighter value proposition, and a centered install command for GitHub/npm presentation.

## [0.6.0] - 2026-06-07

### Changed (breaking)

- **Naming state machine rewritten.** The previous `false | "ai" | "fallback" | "manual"`
  union is replaced with a clean three-state model:
  `"unnamed" | "named" | "fallback"`. The `"manual"` state is gone — once
  pi-autoname is installed, automatic naming owns the session title. See
  the *Migrating from 0.5.x* note below.
- **`respectManualName` now defaults to `false`** (was `true`). After install,
  `/name` and the session-selector rename UI are still functional, but the
  next periodic rename is allowed to overwrite them. Set
  `respectManualName: true` in the config to restore the legacy sticky-rename
  behavior.
- **`debug` is now the single debug switch.** The `PI_AUTONAME_DEBUG`
  environment variable has been removed; flip `debug: true` in
  `~/.pi/agent/pi-autoname.json` to see all diagnostic output, `false` to
  silence everything.

### Added

- **`/name` grace period.** When a session is renamed out-of-band (e.g. via
  `/name`), the next `agent_end` detects the change, records a
  `user_rename` marker in the session's `pi-autoname-state` entries, and
  resets the rename cooldown. The user's choice is then preserved for a
  full `cooldownMinutes` window before the next periodic rename can
  consider overwriting it.
- **Fresh-session detection.** `session_start` now treats a session as
  fresh (`unnamed`) whenever there is no matching `pi-autoname-state`
  entry — even if the session already has a high-quality-looking name
  (e.g. a system-default derived from the cwd basename). This guarantees
  first-dialogue naming runs on every previously-unnamed session,
  including ones created before pi-autoname was installed.
- **`parseRenameMarker(data)`** extracted to `extensions/lib.ts` and
  exported. Pure function, 7 new unit tests covering all three marker
  flavors, malformed data, and missing-timestamp fallbacks.

### Tests

- 52 passing (up from 43). Added 7 `parseRenameMarker` cases + 2
  `respectManualName` / `DEFAULT_CONFIG` regression cases.

### Migration from 0.5.x

If you were relying on `respectManualName: true` (the previous default),
explicitly set it in your config:

```json
{
  "respectManualName": true
}
```

If you used `PI_AUTONAME_DEBUG=1` to enable verbose logging, set
`debug: true` in the config instead.

## [0.5.13] - 2026-06-01

### Fixed

- Audit findings and code-quality pass.
