# Changelog

All notable changes to `pi-autoname` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- 命名语言改为累计会话全部 user 消息判定，不再只看本次命名的近期窗口：中文会话里晚出现的英文消息（粘贴报错、临时英文提问）不再把标题翻成英文；新会话首条消息仍是初名的全部历史，行为不变。
- 质量门拒绝提示词指令回显：修复命名模型把语言与长度指令复述成标题（真实坏例 "Label in Chinese 5-15"），命中时该 AI 候选作废，按原链路降级（下一模型或本地 fallback）。
- 新增标签语言门：auto 模式下 AI 候选与本地降级名的文字体系均须与用户历史判定的语言一致（真实坏例：中文会话被 group/flash 命名为 "The task investigating/confirm"），不符时该候选作废、试下一模型或回溯更早的匹配轮次。
- 命名请求按 Codex（openai/codex）风格重构：指令从十条压缩到三条（约 60 词），新增「Do not answer the request」条款，请求主体改为引用证据本身，语言靠镜像用户输入而非长英文指令墙实现；候选先做格式收敛（去引号、截尾标点含 ASCII 句号、取首从句、限长）再过质量与语言门，提取函数不再内嵌质量判定。
- 修复两个请求参数导致的系统性失败：移除英文系统提示帧（它使同一中转稳定输出英文标题，curl 裸请求对比证实）；输出预算 64→2000 token（推理模型的思考被 64 预算截断到空正文，此前表现为空候选，并非超时）。修后慢速中转的首个 AI 候选直接以中文标题落地。
- 空响应在同一模型延时重试一次（等待可被取消），单次尝试与总预算放宽（75s/90s），慢速会话模型的首候选不再被提前放弃；本地降级同样按判定语言筛选取材轮次。

## [0.7.4] - 2026-11-14

### Changed

- 新增 `doc/GLOSSARY.md` 术语表，统一初名、收口修订、周期改名、marker、提示词线格式等概念的名称与边界；`doc/README.md` 改为编号指路式文档入口。
- README 新增「Project docs」一节，指向文档索引、Agent 规范与测试入口。

## [0.7.3] - 2026-11-14

### Changed

- 统一代码命名风格：`buildLanguageInstruction`、`MAX_NAME_TOKEN_BUDGET`、枚举值 `"toolResult"`；提示词线格式 `<tool-result>` 保持不变，对模型行为无影响。
- 重写 `AGENTS.md`（新增命名约定与 0 配置边界），`doc/README.md` 改为文档导航索引，同步 `extensions/README.md` 导出名。

### Removed

- 移除已过时的 `.doc/` 旧文档（内容已被 `doc/`、`AGENTS.md` 与源码现状取代）；历史可从 Git 追溯。

## [0.7.2] - 2026-11-02

### Changed

- Name each pass from the newest relevant task and outcome, using the previous name only to avoid meaningless rewording. Keep the existing ten-minute periodic cooldown and first-settlement check.
- Include up to two recent text tool outcomes alongside six dialogue texts, retaining the latest user goal. Redact before bounded head/tail excerpts; tool text never determines language or local fallback labels.

### Fixed

- Allow settlement naming to follow a changed outcome found only in tool results, without requiring a new user message or an assistant repetition. Quote context delimiters so embedded tool markup cannot impersonate another prompt section.

## [0.7.1] - 2026-11-02

### Changed

- Require Pi / pi-ai `^1.4.0` and Node.js `>=22.19.0`; refresh the dependency lockfile for the verified host baseline.
- Generate an initial session name in the background from the first textual request/response pair, before long-running tools finish. Refine it once using completed-task context at settlement, then retain the normal rename cooldown. Pending refinement survives reload; manual renames cancel background naming and reject stale results.

### Added

- Default-on `titleSpinner` setting. TUI titles animate as `π - ⠋ - title` during agent work and naming inference, and return to `π - title` when idle. Animation does not change saved session names or make additional model calls.
- Independent tracking of agent and naming work, immediate manual-name refresh, working-directory fallback, control-character sanitization, and timer/abort-listener cleanup on cancellation and session shutdown/reload.
- Unit and extension-integration coverage for title animation, plus offline Pi runtime and terminal checks. The runtime check also supports hoisted host dependencies.
- Explicit `language` locale for AI names, with `auto` as the default and invalid locales safely returning to automatic detection. Addresses #4.
- Optional `:minimal` / `:low` / `:medium` / `:high` / `:xhigh` / `:max` naming-model suffixes, adapted from @chuxubank’s PR #7 to the current host `streamSimple` API.

### Fixed

- Integrate terminal-title tracking with the first-response dialogue snapshot; add combined lifecycle and real TUI checks for early naming, refinement, manual replacement, late results and reload.
- Apply the normal cooldown after a completed fallback naming pass, including after reload, rather than retrying the entire model chain after every turn.
- Honor `/name` even when it repeats the generated title; only the extension's own name-change echo is ignored, including when event delivery is delayed.
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
