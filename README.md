<p align="center">
  <img src="https://github.com/ssdiwu/pi-autoname/releases/download/readme-assets/pi-autoname-cover.png" alt="pi-autoname cover" width="100%" />
</p>

<p align="center">
  <strong>AI-powered semantic session naming for Pi, with an animated terminal-title progress marker.</strong>
</p>

<p align="center">
  Automatically name sessions after the first dialogue, periodically re-name as the conversation evolves, and regenerate on demand with <code>/autoname</code>.
</p>

<p align="center">
  <code>pi install npm:pi-autoname</code>
</p>

## ✨ What it does

| Scenario | Behavior |
|---|---|
| Agent or naming model is working | Animates the terminal title: `π - ⠋ - Session title` |
| Work finishes or is cancelled | Removes the marker: `π - Session title` |
| First dialogue settles | Automatically generates a semantic session name |
| Conversation continues | Silently considers a rename every 10 minutes (configurable) |
| Session topic drifts | Updates only when the current name no longer fits |
| Run `/autoname` | Manually regenerate from recent context |
| AI naming fails | Falls back to smart text extraction |

## 🚀 Install

```bash
pi install npm:pi-autoname
```

**Works out of the box.** No configuration needed — uses your current session's model by default.

### Animated terminal title

```text
Working:  π - ⠋ - Database retries
          π - ⠙ - Database retries
          π - ⠹ - Database retries
Idle:     π - Database retries
```

The marker cycles through ten Braille frames every 120 ms. It starts during agent preparation and stays active through reasoning, streaming, tool calls, retries, and queued follow-ups until `agent_settled`. Background naming and `/autoname` model calls are also tracked, independently of the main agent. Cancellation of naming releases its marker immediately; shutdown, session replacement, and reload clear timers and reject stale updates.

The displayed title is the session name, or the working-directory basename until one is available. The animation only updates the terminal title through `ctx.ui.setTitle()`; it never renames the session, writes animation frames into history, or makes additional model requests. Manual `/name` changes update the displayed title immediately. Control characters are removed before sending a title to the terminal.

This is **TUI-only**: print, JSON, and RPC modes never emit spinner title updates. Set `"titleSpinner": false` and run `/reload` to leave terminal titles entirely to Pi or another extension. The spinner remains available when `"enabled": false` disables AI naming. Avoid running a second title-owning extension alongside it. The terminal must accept application-provided titles; a terminal-side fixed tab-title override can hide the animation.

## ⚙️ Configuration

Config file is **auto-generated** on first use at `~/.pi/agent/pi-autoname.json`:

```json
{
  "enabled": true,
  "titleSpinner": true,
  "model": "",
  "fallbackModels": [],
  "language": "auto",
  "cooldownMinutes": 10,
  "debug": false,
  "respectManualName": false,
  "includeCustomMessages": false
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Set to `false` to disable AI naming |
| `titleSpinner` | boolean | `true` | Animate the terminal title in TUI mode. Independent of AI naming; apply changes with `/reload`. |
| `model` | string | _(session model)_ | Primary model (`provider/modelId` or `provider/modelId:thinking`). Empty = use session model |
| `fallbackModels` | string[] | `[]` | Additional models to try if primary fails; the same `:thinking` suffix is supported |
| `language` | string | `"auto"` | BCP 47 locale such as `zh-CN`, `zh-TW`, or `en` for AI names; explicit values override detection and the Pi locale |
| `cooldownMinutes` | number | `10` | Minutes between periodic re-names |
| `debug` | boolean | `false` | Enable debug logging |
| `respectManualName` | boolean | `false` | When `false` (default), a `/name` change gets one cooldown window before automatic naming resumes. Set to `true` to keep a user-issued `/name` until `/autoname` is explicitly run. |
| `includeCustomMessages` | boolean \| string[] | `false` | Include `custom_message` entries as context in the naming prompt. `false` ignores them, `true` includes all of them, and an array whitelists them by `customType`. Use this when messages injected by pi extensions carry valuable information for naming. |

### Example: Model fallback chain

```json
{
  "enabled": true,
  "model": "minimax-cn/MiniMax-M2.7",
  "fallbackModels": [
    "xiaomi-token-plan-cn/mimo-v2-omni"
  ],
  "cooldownMinutes": 10
}
```

This tries models in order: `MiniMax-M2.7` → `mimo-v2-omni` → session model.

For example, `"model": "xai/grok-4.6:low"` selects the model with Pi’s unified `reasoning: "low"` option. Supported suffixes are `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; unknown suffixes remain part of the model ID. Authentication, provider routing, cancellation, and the shared 30-second budget still belong to the same host runtime path.

### Example: Name worker sessions from injected assignments

When a pi extension is used to coordinate agents, relevant context information may be injected into the chat history as a `custom_message` (e.g. via `pi.sendMessage(..., { customType: "my-pi-orchestrator" })`) rather than as a typed user message. By default, custom messages are ignored by `pi-autoname`. By whitelisting the relevant message types, we can ensure that the inferred name takes the relevant context into account:

```json
{
  "includeCustomMessages": ["my-pi-orchestrator"]
}
```

Matching entries with text are treated as user turns: they keep their chronological position in the recent-context window, count toward it, can serve as the first user turn, and take part in language detection. Entries without text do not count toward the recent window or the initial-history check. The entry's `display` flag is ignored, because hidden messages still reach the model.

## 🏗️ How it works

### Automatic naming

```
first complete dialogue
        ↓
Pi reaches agent_settled
        ↓
AI generates a semantic session name in the background
        ↓
setSessionName(name)
```

### Periodic re-naming

```
agent_settled event (all retry/follow-up work complete)
        ↓
cooldown passed? (10 min default)
        ↓
AI checks recent context against the current name
        ↓
topic changed? → silently update
name still fits? → keep it
```

### Model fallback chain

```
primary model (from config)
        ↓ failed within the shared 30-second budget?
fallback models (from config)
        ↓ failed?
session model (automatic)
        ↓ failed?
smart text extraction (no AI)
```

### Manual naming

```bash
/autoname
```

Regenerates the session name from recent conversation context. Useful when you want to force an immediate rename.

### Built-in `/name` is largely redundant

Pi's native command still works:

```bash
/name My custom title
```

With the default `respectManualName: false`, pi-autoname gives `/name` a full `cooldownMinutes` grace period, then may resume automatic naming if the topic changes. It observes the name change immediately through Pi's session metadata event.

- For a one-shot rename that pi-autoname may later take over again: use `/name`.
- To force a re-name from the current conversation right now: use `/autoname`.
- To keep a `/name` indefinitely: set `respectManualName: true`. Running `/autoname` remains an explicit override.

#### Stable periodic names

Periodic naming compares recent context with the current title. The model is asked to return the existing title unchanged when it still fits, so the extension avoids needless title churn and session metadata writes.

## 🔐 Privacy note

`pi-autoname` sends a short, recent conversation excerpt to the selected naming model. With `includeCustomMessages` enabled, that excerpt also contains the matching extension-injected messages, including messages with `display: false`. Before sending, it redacts common secret patterns such as API keys, bearer tokens, AWS access keys, private keys, `*_TOKEN` / `*_SECRET` / `*_PASSWORD` environment assignments, and quoted JSON credential fields (including escaped string values). Redaction is pattern-based and cannot guarantee detection of every sensitive value or encoding. If the AI call fails and the user text contained a detected secret, the local fallback name is skipped to avoid turning secrets into session names. Debug logs contain status events and selected diagnostic metadata only; session names, conversation text, file paths, and raw provider/configuration errors are not logged.

## 🌍 Language support

Set `"language": "zh-CN"` (or another BCP 47 locale) to explicitly choose the language of AI names. Invalid values fall back to `"auto"`. This setting is a model instruction; local fallback extraction cannot translate the user’s text.

With the default `"language": "auto"`, names use the dominant natural language in user messages: the first user message for initial naming, and recent user messages for periodic or manual naming. Assistant responses, paths, URLs, and code snippets do not determine the language. A user message that contains any Han / Kana / Hangul characters is treated as a CJK-language message, so English noise co-injected into the same turn (system warnings, error logs, tool output) cannot outweigh the user's CJK intent; only purely-Latin user messages contribute to the English score. When no natural-language user text is available, pi-autoname optionally uses the active [pi-di18n](https://github.com/ssdiwu/pi-di18n) `/lang` locale; pi-di18n is never required.

## 🔗 Related

- [pi-compaction-i18n](https://github.com/ssdiwu/pi-compaction-i18n) — localized compaction summaries

## Development

The repository has no development dependency. With Node.js 22.6 or later (Node.js 22.22.3 is the tested baseline), run the built-in TypeScript test runner directly:

```bash
npm test
```

Pi provides the two declared peer dependencies at extension runtime. The current host verification baseline is Pi **1.4.0** (Node.js **24.21.0**). Naming calls use `ctx.modelRegistry.streamSimple().result()` so Pi resolves provider authentication, including providers that do not require an API key.

An additional offline check uses the installed Pi loader, runner, session manager, and model runtime with an in-memory test provider:

```bash
PI_HOST_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" node tests/pi-host-smoke.mjs
```

This checks automatic/manual naming, reload state, redaction, failure fallback, TUI animation, final settlement, shutdown cleanup, and RPC silence without using personal credentials or external models. On Linux/macOS, an additional Python 3 PTY test exercises real terminal-title output, `/name`, `/reload`, and Escape cancellation:

```bash
PI_HOST_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" python3 tests/pi-tui-smoke.py
```

Set `PI_HOST_ROOT` to the actual installed package directory if Pi is managed outside global npm. These are offline automated tests, not a live-model or graphical-terminal acceptance test. See [compatibility evidence and limits](doc/Pi版本兼容性与影响分析.md).

AI replies use the first nonempty text line, or the last nonempty thinking line when no text was returned, and share the same 30-character limit as local fallback labels. The quality gate checks length and basic sentence patterns; it cannot guarantee that a model’s chosen line is semantically useful.

## Contributors

Thanks to [@git-geeky](https://github.com/git-geeky) for the name-quality fixes in [PR #2](https://github.com/ssdiwu/pi-autoname/pull/2), [@LoveSnowEx](https://github.com/LoveSnowEx) for the lazy-session diagnostic fix in [PR #3](https://github.com/ssdiwu/pi-autoname/pull/3), and [@chuxubank](https://github.com/chuxubank) for thinking-suffix support in [PR #7](https://github.com/ssdiwu/pi-autoname/pull/7). These contributions are adapted to Pi’s current host runtime.

Thanks to [Luca Mondada (@lmondada)](https://github.com/lmondada) for contributing opt-in custom-message context through [PR #8](https://github.com/ssdiwu/pi-autoname/pull/8). His `includeCustomMessages` setting lets extension-injected assignments inform session names, with support for selecting specific `customType` values.

## License

MIT
