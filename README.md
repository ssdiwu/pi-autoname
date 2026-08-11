<p align="center">
  <img src="https://github.com/ssdiwu/pi-autoname/releases/download/readme-assets/pi-autoname-cover.png" alt="pi-autoname cover" width="100%" />
</p>

<p align="center">
  <strong>AI-powered semantic session naming for Pi.</strong>
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

## ⚙️ Configuration

Config file is **auto-generated** on first use at `~/.pi/agent/pi-autoname.json`:

```json
{
  "enabled": true,
  "model": "",
  "fallbackModels": [],
  "cooldownMinutes": 10,
  "debug": false,
  "locale": "",
  "maxNameLength": 30,
  "promptExtra": "",
  "ticketPattern": "",
  "respectManualName": false
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Set to `false` to disable AI naming |
| `model` | string | _(session model)_ | Primary model (`provider/modelId`). Empty = use session model |
| `fallbackModels` | string[] | `[]` | Additional models to try if primary fails |
| `cooldownMinutes` | number | `10` | Minutes between periodic re-names |
| `debug` | boolean | `false` | Enable debug logging |
| `locale` | string | `""` | Override the locale used when user messages contain no detectable natural language |
| `maxNameLength` | number | `30` | Maximum saved name length, including any ticket prefix. Clamped to `3..120` |
| `promptExtra` | string | `""` | Extra instruction appended to the naming prompt |
| `ticketPattern` | string | `""` | Optional regex. Exactly one unique match in the first user message is pinned and forced as the prefix of later generated names |
| `respectManualName` | boolean | `false` | When `false` (default), a `/name` change gets one cooldown window before automatic naming resumes. Set to `true` to keep a user-issued `/name` until `/autoname` is explicitly run. |

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

### Configurable naming preferences

`locale` is used only when user-authored text does not identify a natural language. `promptExtra` is appended as a user preference, and `maxNameLength` applies to the complete saved name, including a trusted ticket prefix.

With `ticketPattern`, pi-autoname scans only the first user message. It pins a ticket only when there is exactly one unique match; assistant replies, later dialogue, and existing session names are never ticket sources. The pinned ticket is persisted between renames. If no trusted ticket exists, a ticket-like prefix returned by the model is removed before saving.

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

`pi-autoname` sends a short, recent conversation excerpt to the selected naming model. Before sending, it redacts common secret patterns such as API keys, bearer tokens, AWS access keys, private keys, and `*_TOKEN` / `*_SECRET` / `*_PASSWORD` environment assignments. If the AI call fails and the user text contained a detected secret, the local fallback name is skipped to avoid turning secrets into session names.

## 🌍 Language support

Names use the dominant natural language in user messages: the first user message for initial naming, and recent user messages for periodic or manual naming. Assistant responses, paths, URLs, and code snippets do not determine the language. A user message that contains any Han / Kana / Hangul characters is treated as a CJK-language message, so English noise co-injected into the same turn (system warnings, error logs, tool output) cannot outweigh the user's CJK intent; only purely-Latin user messages contribute to the English score. When no natural-language user text is available, pi-autoname optionally uses the active [pi-di18n](https://github.com/ssdiwu/pi-di18n) `/lang` locale; pi-di18n is never required.

## 🔗 Related

- [pi-compaction-i18n](https://github.com/ssdiwu/pi-compaction-i18n) — localized compaction summaries

## Development

The repository has no development dependency. With Node.js 22.6 or later (Node.js 22.22.3 is the tested baseline), run the built-in TypeScript test runner directly:

```bash
npm test
```

Pi provides the two declared peer dependencies at extension runtime.

## License

MIT
