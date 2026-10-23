# Changelog

All notable changes to `pi-autoname` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Default-on `titleSpinner` setting. TUI titles animate as `π - ⠋ - title` during agent work and naming inference, and return to `π - title` when idle. Animation does not change saved session names or make additional model calls.
- Independent tracking of agent and naming work, immediate manual-name refresh, working-directory fallback, control-character sanitization, and timer/abort-listener cleanup on cancellation and session shutdown/reload.
- Unit and extension-integration coverage for title animation, plus offline Pi runtime and terminal checks. The runtime check also supports hoisted host dependencies.
- Explicit `language` locale for AI names, with `auto` as the default and invalid locales safely returning to automatic detection. Addresses #4.
- Optional `:minimal` / `:low` / `:medium` / `:high` / `:xhigh` / `:max` naming-model suffixes, adapted from @chuxubank’s PR #7 to the current host `streamSimple` API.

### Fixed

- Treat not-yet-created session files as normal, while retaining safe diagnostics for other IO errors. Adapted from @LoveSnowEx’s PR #3.
- Extract a concise line from multiline model replies and keep AI/local fallback names within the same quality limit. Adapted from @git-geeky’s PR #2.

## [0.7.0] - 2026-10-19

### Added

- New opt-in `includeCustomMessages` setting (`false` by default) to include `custom_message` entries as context in the naming prompt. Set it to `true` to include all of them, or to an array of `customType` values to whitelist specific ones. Thanks to [@lmondada](https://github.com/lmondada) for [PR #8](https://github.com/ssdiwu/pi-autoname/pull/8).

### Fixed

- Ignore textless custom messages when deciding whether an initial dialogue already has a history, so image-only or empty injected messages cannot trigger naming from an assistant-only excerpt.

- Keep debug diagnostics without logging session names, conversation text, session file paths, or raw exception messages.

- Redact quoted JSON credential fields, including escaped string values, before naming requests and prevent detected credentials from becoming local fallback titles.
- Allow naming with keyless providers by calling Pi's configured model runtime through `ctx.modelRegistry.streamSimple().result()` instead of requiring an API key and using the global compat API. Verified offline against Pi 1.3.0.

- Language detection no longer lets English co-injected into a CJK user message (e.g. system warnings, error logs, or tool output that Pi places inside a user turn) outweigh the user's actual CJK intent. A user message containing any Han/Kana/Hangul is now treated as a CJK-language message; only purely-Latin user messages contribute to the English score. Fixes periodic/`/autoname` titles flipping to English when a recent user turn carried a long English warning (e.g. a `pi-di18n` compaction notice).

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
