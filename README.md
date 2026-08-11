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
| First dialogue completes | Automatically generates a semantic session name |
| Conversation continues | Silently re-names every 10 minutes (configurable) |
| Session topic drifts | Name updates to reflect the new focus |
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
  "maxNameLength": 30,
  "ticketPattern": "",
  "respectManualName": true
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Set to `false` to disable AI naming |
| `model` | string | _(session model)_ | Primary model (`provider/modelId`). Empty = use session model |
| `fallbackModels` | string[] | `[]` | Additional models to try if primary fails |
| `cooldownMinutes` | number | `10` | Minutes between periodic re-names |
| `debug` | boolean | `false` | Enable debug logging |
| `maxNameLength` | number | `30` | Max accepted generated name length. Clamped to `3..120` |
| `ticketPattern` | string | `""` | Optional regex. Exactly one unique match in the first user message is pinned and forced as the prefix of later generated names |
| `respectManualName` | boolean | `true` | Preserve a name set through Pi's `/name` or session rename UI. `/autoname` remains an explicit opt-in override. |

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

### Example: Longer names with work-ticket prefixes

```json
{
  "maxNameLength": 80,
  "ticketPattern": "\\b((?:DVR|OST|ZATO)-\\d+)\\b"
}
```

pi-autoname checks only the first user message and pins the ticket only when the configured pattern produces exactly one unique value. Assistant replies, later dialogue, and an existing session name are not ticket sources. Periodic and `/autoname` renames retain a safely pinned ticket after it leaves the recent conversation window. When no trusted ticket is pinned, a ticket-like prefix suggested by the naming model is removed before the name is saved.

## 🏗️ How it works

### Automatic naming

```
first user message
        ↓
first assistant reply finishes
        ↓
AI generates semantic session name
        ↓
setSessionName(name)
```

### Periodic re-naming

```
agent_settled event (new message processed)
        ↓
cooldown passed? (10 min default)
        ↓
AI generates new name from recent context
        ↓
name changed? → silently update
name same? → skip
```

### Model fallback chain

```
primary model (from config)
        ↓ failed?
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

### Built-in `/name` is preserved

Pi's native command still works:

```bash
/name My custom title
```

When you `/name` a session, pi-autoname observes the change immediately through `session_info_changed`, persists a manual-name marker, and protects that name across future turns and session restores. To explicitly regenerate it, use `/autoname`.

## 🔐 Privacy note

`pi-autoname` sends a short, recent conversation excerpt to the selected naming model. Before sending, it redacts common secret patterns such as API keys, bearer tokens, AWS access keys, private keys, and `*_TOKEN` / `*_SECRET` / `*_PASSWORD` environment assignments. If the AI call fails and the user text contained a detected secret, the local fallback name is skipped to avoid turning secrets into session names.

## 🌍 Naming language

The naming language is inferred from natural-language text written by the user. Assistant replies, code, paths, and identifiers do not override it. If a session has no natural-language user text, Pi's own locale is used only as a fallback.

After compaction, naming receives the latest compaction summary together with the recent post-compaction message tail, so the title can retain the original task while following the current focus.

## 🔗 Related

- [pi-compaction-i18n](https://github.com/ssdiwu/pi-compaction-i18n) — localized compaction summaries

## License

MIT
