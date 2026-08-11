# Changelog

All notable changes to `pi-autoname` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Configurable naming preferences: `locale`, `maxNameLength`, `promptExtra`, and `ticketPattern`.

### Fixed

- Language detection no longer lets English co-injected into a CJK user message (e.g. system warnings, error logs, or tool output that Pi places inside a user turn) outweigh the user's actual CJK intent. A user message containing any Han/Kana/Hangul is now treated as a CJK-language message; only purely-Latin user messages contribute to the English score. Fixes periodic/`/autoname` titles flipping to English when a recent user turn carried a long English warning (e.g. a `pi-di18n` compaction notice).
- Ticket prefixes are trusted only when a single unique ticket is found in the first user message, persisted between renames, and removed when suggested only by the model. The configured maximum now applies to the complete saved name, including the ticket prefix.

## [0.6.8] - 2026-07-22

### Fixed

- Detect the dominant language from user-authored natural-language messages before naming; use pi-di18n's active `/lang` locale only as an optional fallback when the user text is code-only or unavailable.

## [0.6.7] - 2026-07-22

### Fixed

- Auto-generated names now follow the language predominantly used in user messages instead of being forced by the host system locale.

## [0.6.6] - 2026-07-18

### Changed

- Auto-naming now runs after Pi's fully settled lifecycle event, cancels stale requests on session changes, and bounds the complete model fallback chain to a shared 30-second budget.
- Periodic naming compares the current title with recent context so unchanged topics keep their existing title; older unmarked sessions use recent context rather than an obsolete first exchange.
- `/name` changes are observed immediately. `respectManualName: true` now keeps a manual title until `/autoname` is explicitly invoked.
- Development tests now use Node.js built-in `node:test` directly on TypeScript. Vitest and all project development dependencies were removed.

## [0.6.5] - 2026-06-18

### Added

- Extension lifecycle tests for `session_start`, `agent_end`, cooldown gating, out-of-band `/name` detection, and current-session JSONL diagnostics.
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
