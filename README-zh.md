<p align="center">
  <img src="https://github.com/ssdiwu/pi-autoname/releases/download/readme-assets/pi-autoname-cover.png" alt="pi-autoname cover" width="100%" />
</p>

<p align="center">
  <strong>为 Pi 提供 AI 语义化会话命名，并带动画式终端标题进度标记。</strong>
</p>

<p align="center">
  从第一组请求／回复对话生成会话名，任务稳定后自动收敛修订，并用 <code>/autoname</code> 随时重新生成。
</p>

<p align="center">
  <code>pi install npm:pi-autoname</code>
</p>

[English](./README.md) | 简体中文

## ✨ 它做什么

| 场景 | 行为 |
|---|---|
| Agent 或命名模型正在工作 | 终端标题动画：`π - ⠋ - 会话标题` |
| 所有 Agent 与命名工作结束 | 移除标记：`π - 会话标题` |
| 首个纯文本请求／回复对到达 | 在任务继续进行时生成初名 |
| 首个任务稳定 | 用已完成的任务重新审视该名称 |
| 对话继续 | 每 10 分钟静默考虑一次改名（可配置） |
| 会话主题漂移 | 仅当当前名称已不合适时才更新 |
| 执行 `/autoname` | 基于近期上下文手动重新生成 |
| AI 命名失败 | 回退到智能文本提取 |

## 🚀 安装

```bash
pi install npm:pi-autoname
```

**开箱即用。** 无需配置——默认使用当前会话的模型。

### 终端标题动画

```text
Working:  π - ⠋ - Database retries
          π - ⠙ - Database retries
          π - ⠹ - Database retries
Idle:     π - Database retries
```

标记以每 120 ms 一帧的节奏循环十个盲文（Braille）帧。它在 Agent 准备阶段启动，并在推理、流式输出、工具调用、重试和排队续跑期间保持活动，直到 `agent_settled`。后台命名与 `/autoname` 的模型调用也会被单独跟踪，与主 Agent 无关。收口时 Escape 会清除主 Agent 活动；后台命名可能继续到完成或自身被取消。命名被取消会立即释放其标记；关闭、会话替换和重载会清理定时器并拒绝过期更新。

显示的标题是会话名，在还没有会话名时用工作目录的 basename。动画只通过 `ctx.ui.setTitle()` 更新终端标题；它不会重命名会话，不会把动画帧写进历史，也不会发起额外模型请求。手动 `/name` 会立刻更新显示标题。发送给终端前会移除控制字符。

这是 **仅限 TUI** 的功能：print、JSON 和 RPC 模式都不会输出 spinner 标题更新。把 `"titleSpinner"` 设为 `false` 并执行 `/reload`，即可把终端标题完全交给 Pi 或其他扩展。即使 `"enabled": false` 禁用 AI 命名，spinner 仍然可用。不要与另一个会占用终端标题的扩展同时运行。终端必须接受应用提供的标题；终端侧的固定 tab 标题覆盖设置可能遮蔽动画。

## ⚙️ 配置

配置文件在**首次使用**时自动生成于 `~/.pi/agent/pi-autoname.json`：

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

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `true` | 设为 `false` 关闭 AI 命名 |
| `titleSpinner` | boolean | `true` | 在 TUI 模式下为终端标题加动画。与 AI 命名相互独立；改动后需 `/reload` 生效。 |
| `model` | string | _（会话模型）_ | 主模型（`provider/modelId` 或 `provider/modelId:thinking`）。留空 = 使用会话模型 |
| `fallbackModels` | string[] | `[]` | 主模型失败时依次尝试的备用模型；同样支持 `:thinking` 后缀 |
| `language` | string | `"auto"` | BCP 47 locale，如 `zh-CN`、`zh-TW` 或 `en`，用于 AI 命名；显式值优先于自动检测与 Pi locale |
| `cooldownMinutes` | number | `10` | 周期改名之间的分钟数 |
| `debug` | boolean | `false` | 开启调试日志 |
| `respectManualName` | boolean | `false` | 为 `false`（默认）时，`/name` 改名会获得一个冷却窗口，之后自动命名可恢复。设为 `true` 时，用户通过 `/name` 设定的名称会被保留，直到显式执行 `/autoname`。 |
| `includeCustomMessages` | boolean \| string[] | `false` | 把 `custom_message` 条目作为命名提示词的上下文。`false` 忽略它们，`true` 全部纳入，数组则按 `customType` 白名单纳入。当 Pi 扩展注入的消息携带对命名有价值的信息时使用。 |

### 示例：模型回退链

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

按顺序尝试：`MiniMax-M2.7` → `mimo-v2-omni` → 会话模型。

例如 `"model": "xai/grok-4.6:low"` 会选中配合 Pi 统一 `reasoning: "low"` 选项的模型。支持的后缀为 `minimal`、`low`、`medium`、`high`、`xhigh` 和 `max`；未知后缀仍作为模型 ID 的一部分。认证、提供方路由、取消和共享的 90 秒预算仍走同一宿主运行时路径。

### 示例：从注入的任务为 worker 会话命名

当用 Pi 扩展协调 Agent 时，相关上下文信息可能以 `custom_message` 的形式注入聊天历史（例如 `pi.sendMessage(..., { customType: "my-pi-orchestrator" })`），而不是有类型的用户消息。默认情况下 `pi-autoname` 忽略自定义消息。通过白名单列出相关消息类型，可以确保推断出的名称把相关上下文纳入考虑：

```json
{
  "includeCustomMessages": ["my-pi-orchestrator"]
}
```

有文本的匹配条目被当作用户轮次处理：它们在近期上下文窗口中保持时间顺序、计入窗口、可以充当首个用户轮次，也参与语言检测。没有文本的条目不计入近期窗口，也不参与初始历史判定。条目的 `display` 标志会被忽略，因为隐藏消息同样会到达模型。

## 🏗️ 工作方式

### 自动命名

```
首个纯文本请求／回复对（message_end）
        ↓
AI 在后台生成初名
        ↓
Agent 继续工作，包括工具调用
        ↓
agent_settled → 用近期任务上下文重新审视名称
```

初名不等待工具执行结束。纯工具、纯思考、失败和被取消的回复都不会触发它。收口时的一次修订会绕过常规冷却，若现有名称仍然贴切则保持不变；后续更新走正常冷却。因此首个任务可能经历两次命名。收口时的修订会取消仍在运行的初名请求，迟到结果不能覆盖它的名称。

在已有初名被保存的前提下，待完成的修订在重载后仍然存在。`/name` 或 `/autoname` 会取消该修订；手工名称保护和常规宽限期仍然适用。如果连早期命名都没能尝试，收口时的命名依然可用。没有标记的旧会话继续使用近期上下文，而不是过时的开场对话。

### 周期改名

```
agent_settled 事件（所有重试／续跑工作完成）
        ↓
冷却已过？（默认 10 分钟）
        ↓
AI 用近期上下文对照当前名称
        ↓
主题变了？→ 静默更新
名称仍贴切？→ 保持
```

### 模型回退链

```
主模型（来自配置）
        ↓ 失败、超时（单次 75s，共享 90s）或返回空（一次延时重试）？
备用模型（来自配置）
        ↓ 失败？
会话模型（自动）
        ↓ 失败，或 auto 模式下候选语言不符？
从用户自己的文本中做智能文本提取（无 AI）
```

### 手动命名

```bash
/autoname
```

基于近期对话上下文重新生成会话名。当你希望立即强制改名时很有用。

### 内置的 `/name` 基本多余

Pi 的原生命令仍然可用：

```bash
/name My custom title
```

在默认的 `respectManualName: false` 下，pi-autoname 给 `/name` 一个完整的 `cooldownMinutes` 宽限期，之后若主题变化可能恢复自动命名。它通过 Pi 的会话元数据事件立即观测到改名。

- 想要一次性改名、之后 pi-autoname 可能再次接管：用 `/name`。
- 想现在就按当前对话重新命名：用 `/autoname`。
- 想永久保留 `/name` 的结果：设置 `respectManualName: true`。执行 `/autoname` 仍是显式覆盖。

#### 稳定的周期名称

每次命名都先确定最新的相关任务与结论。旧名称只作为措辞参考：当它仍准确描述该任务时保留，避免无意义的改写；当任务或结论已变化时替换。后续发现可能来自助手摘要或工具结果；更早被取消或被取代的任务不决定名称。

近期命名上下文包含最多六条用户／助手文本消息，长时间工具工作中保留最新的用户目标，并在该目标之后最多带上两条最新的文本类工具结果。自定义消息仍遵循 `includeCustomMessages`。工具证据不决定命名语言，也永不用于本地降级标题。摘录前每段文本都会脱敏；长文本在 700 字符预算内同时保留开头与结论。新会话的首个回复快照仍是初始的请求／回复对。

10 分钟的默认冷却不变：后续自动检查在冷却到期后的收口时进行，而不是按固定消息条数。首次收口的那一次检查仍然绕过冷却。

## 🔐 隐私说明

`pi-autoname` 会把一小段近期对话摘录，以及最多两条近期文本类工具结果摘录，发送给选定的命名模型。工具结果可能包含文件内容、命令输出或检索到的信息，因此即使助手没有复述，这些文本现在也会参与命名。非文本工具内容被排除；工具指令被当作不可信的引用数据。启用 `includeCustomMessages` 后，摘录中还包含匹配的扩展注入消息，包括 `display: false` 的消息。发送前，它会脱敏常见密钥模式，例如 API key、bearer token、AWS access key、私钥、`*_TOKEN` / `*_SECRET` / `*_PASSWORD` 环境变量赋值，以及带引号的 JSON 凭据字段（包括转义后的字符串值）。脱敏基于模式匹配，无法保证发现所有敏感值或编码方式。若 AI 调用失败且用户文本中包含被检测到的密钥，本地降级名会被跳过，以免把密钥变成会话名。调试日志只包含状态事件和选定的诊断元数据；会话名、对话文本、文件路径以及原始提供方／配置错误都不会写入日志。

## 🌍 语言支持

把 `"language"` 设为 `"zh-CN"`（或其他 BCP 47 locale）可显式选择 AI 命名的语言。非法值回退为 `"auto"`。该设置是一条模型指令；本地降级提取无法翻译用户文本。

默认的 `"language": "auto"` 下，名称使用会话中所有用户消息里占主导的自然语言：每个用户轮次都累计计分，因此语言跟随用户的长期输入，而不是最近一次命名窗口（后出现的一条英文消息，例如粘贴的报错或临时的英文提问，无法把以中文为主的会话翻成英文标题）。在新会话尚无任何回复前，首条用户消息仍决定初名，因为那时它就是全部历史。作为确定性闸门，文字体系与判定语言不符的 AI 候选会被拒绝，链路转试下一个模型；本地降级同样从最近一个文字体系匹配的用户轮次取材，在近期证据窗口内向前回溯，找不到安全合格且语言匹配的轮次时就不生成降级名。显式的 `language` 配置按原样信任，跳过该闸门。助手回复、路径、URL 和代码片段不决定语言。含有任何汉字／假名／韩文字符的用户消息被视为 CJK 语言消息，因此注入同一轮次的英文噪声（系统警告、错误日志、工具输出）不能压过用户的 CJK 意图；只有纯拉丁字母的用户消息才计入英文分。当没有可用的自然语言用户文本时，pi-autoname 可选地使用当前 [pi-di18n](https://github.com/ssdiwu/pi-di18n) 的 `/lang` locale；pi-di18n 不是必需依赖。

## 🔗 相关项目

- [pi-compaction-i18n](https://github.com/ssdiwu/pi-compaction-i18n) —— 本地化的压缩摘要

## 🗂️ 项目文档

- [doc/README](doc/README.md) —— 文档索引（术语表、实现说明、兼容证据、历史归档）
- [AGENTS.md](AGENTS.md) —— 面向贡献者的工程、隐私与交付规则
- [tests/README](tests/README.md) —— 测试入口与各项检查能证明什么

## 公开契约

- **扩展入口**：`index.ts` 导出默认函数 `extension(pi: ExtensionAPI)`；`package.json` 通过 `pi.extensions` 注册它。
- **使用到的事件**：`session_start`、`session_info_changed`、`message_end`、`before_agent_start` / `agent_start`、`agent_settled`、`session_shutdown`，以及 `/autoname` 命令。
- **配置契约**：`~/.pi/agent/pi-autoname.json` 的字段含义与默认值见上文配置表；配置文件只在首次使用时生成。
- **命名结果约束**：名称简短稳定，来自会话语义，经过清洗和质量校验；AI 回复取第一个非空文本行，没有文本时取最后一个非空思考行，与本地降级标签共用 30 字符上限。命名请求不带 system prompt（英文系统框会把标签引向英文），输出预算为 2000 token。
- **数据边界**：会话内容和标题不写入日志、不发送未授权提供方、不额外持久化为提示词。发送给模型的是脱敏后的近期摘录。
- **模型调用**：命名请求走 Pi 公开模型接口 `ctx.modelRegistry.streamSimple().result()`，由 Pi 负责认证、提供方路由与取消；扩展不硬编码 provider、模型或 Key。
- **时间预算**：单次尝试 75 秒，共享总预算 90 秒；空响应在同一模型延时重试一次。
- **命名导出**：调试诊断只输出可读性、名称／marker 是否存在、marker 种类与解析错误数，不输出名称、路径或原始异常。

## 开发

本仓库没有开发依赖。Node.js 22.19.0 及以上（当前集成基线为 Node.js 24.16.0）可直接运行内置 TypeScript 测试运行器：

```bash
npm test
```

Pi 在扩展运行时提供两个声明的 peer 依赖（`@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent`，均为 `^1.4.0`）。当前集成基线是 Pi **1.6.0**（Node.js **24.16.0**）。命名调用使用 `ctx.modelRegistry.streamSimple().result()`，因此 Pi 负责解析提供方认证，包括不需要 API key 的提供方。

额外的离线检查会使用已安装的 Pi 加载器、runner、session manager 与模型运行时，配合内存测试提供方：

```bash
PI_HOST_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" node tests/pi-host-smoke.mjs
```

该检查覆盖自动／手动命名、重载状态、脱敏、失败降级、TUI 动画、最终收口、关闭清理与 RPC 静默，不使用个人凭据或外部模型。在 Linux/macOS 上，还有一个 Python 3 PTY 测试会在受控工具期间验证提前命名、收口修订、真实终端标题输出、`/name`、`/reload` 与 Escape 取消：

```bash
PI_HOST_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" python3 tests/pi-tui-smoke.py
```

另一个使用真实 `AgentSession` 的检查验证：等待型 fixture 工具运行期间首个标题就出现，动画在提前命名与修订期间保持活动，收口修订后最终标题恢复为空闲态：

```bash
PI_HOST_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" node tests/pi-early-naming-smoke.mjs
```

若 Pi 不是通过全局 npm 托管的，把 `PI_HOST_ROOT` 设为实际安装包目录。这些检查使用离线提供方，不是真实模型或图形终端验收。参见[兼容证据与边界](doc/references/Pi版本兼容性与影响分析.md)。

## 贡献

- **入口**：`index.ts` 与 `extensions/`（实现）、`tests/`（单元、生命周期与集成测试，见 [tests/README](tests/README.md)）、`README.md` 与 `README-zh.md`（用户文档）、`AGENTS.md`（工程、隐私与交付规则）、`doc/README.md`（文档索引）、`doc/术语表.md`（概念名称与边界）。
- **本地验证**：`npm test`。触发时机或 Pi API 变化时，还要跑上面三个离线宿主／终端检查（`pi-host-smoke.mjs`、`pi-early-naming-smoke.mjs`、`pi-tui-smoke.py`）。离线宿主检查、真实模型测试与终端人工操作分别报告，未覆盖项明确说明。
- **文档同步**：同一次改动里更新 `README.md`（英文）与 `README-zh.md`（中文），两版保留全部技术细节，并保持页面顶部互链。
- **变更记录**：日常把用户可感知的变化写入本仓 `CHANGELOG-zh.md`，准备发布时按版本同步进英文 `CHANGELOG.md`；两份 changelog 与两版 README 都随 npm 包发布。
- **打包核对**：发布前用 `npm pack --dry-run --ignore-scripts --json` 查看包清单，确认包含 `README.md`、`README-zh.md`、`CHANGELOG.md` 与 `CHANGELOG-zh.md`。
- **边界**：命名必须来自会话语义并经清洗与质量校验；会话内容和标题不得进入日志、未授权提供方或额外持久化的提示词；模型选择、认证与请求交给 Pi 公开模型接口，不硬编码 provider、模型或 Key。

## 贡献者

感谢 [@git-geeky](https://github.com/git-geeky) 在 [PR #2](https://github.com/ssdiwu/pi-autoname/pull/2) 中的名称质量修复、[@LoveSnowEx](https://github.com/LoveSnowEx) 在 [PR #3](https://github.com/ssdiwu/pi-autoname/pull/3) 中的惰性会话诊断修复，以及 [@chuxubank](https://github.com/chuxubank) 在 [PR #7](https://github.com/ssdiwu/pi-autoname/pull/7) 中的思考后缀支持。这些贡献已适配 Pi 当前的宿主运行时。

感谢 [Luca Mondada (@lmondada)](https://github.com/lmondada) 通过 [PR #8](https://github.com/ssdiwu/pi-autoname/pull/8) 贡献的可选自定义消息上下文。他的 `includeCustomMessages` 设置让扩展注入的任务能参与会话命名，并支持按 `customType` 选择具体类型。

感谢 [@jack-o-mania](https://github.com/jack-o-mania) 在 [PR #10](https://github.com/ssdiwu/pi-autoname/pull/10) 中的终端标题动画，以及 [PR #11](https://github.com/ssdiwu/pi-autoname/pull/11) 中的提前会话命名与收口修订。

## 许可证

MIT
