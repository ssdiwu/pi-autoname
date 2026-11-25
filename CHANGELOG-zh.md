# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 的基本格式。带 tag 的发布以 Git tag 为版本号；已发布版本由发布负责人负责维护英文 `CHANGELOG.md`，本文件是对应版本的中文镜像。两份日志只记录用户可感知事实，日常用中文记录，准备发布（release）时按版本同步到英文，并都随 npm 包发布。

新发布使用 `## [x.y.z] - YYYY-MM-DD` 格式的标题；条目可唯一对应 GitHub issue 时，在末尾附 `(#xx)`。历史条目保留原有标题格式。

## [0.7.6] - 2026-11-25

- 自动会话命名和 `/autoname` 支持 Pi 1.6.0。

## [0.7.5] - 2026-11-14

### Fixed

- 命名语言现在从累积会话中的全部用户消息判定，而不只是当前命名轮次的近期窗口：中文对话里较晚出现的英文消息（粘贴的错误、偶尔的英文提问）不再把标题翻成英文；对新会话，首条消息仍是初始命名可用的全部历史，因此行为不变。
- 质量门禁拒绝 prompt 指令回显：修复命名模型把语言和长度指令当标题复述的问题（真实反例：`"Label in Chinese 5-15"`）；检测到后丢弃该 AI 候选，走已有的回退链（下一个模型或本地回退）。
- 新增标题语言门禁：`auto` 模式下 AI 候选与本地回退名都必须使用从用户历史判定的书写系统（真实反例：中文会话被 group/flash 命名为 `"The task investigating/confirm"`）；不匹配就丢弃候选并尝试下一个模型；回退名会在近期证据窗口内向更早的消息查找匹配轮次，找不到安全且合格的匹配时不生成回退名。
- 按 Codex（`openai/codex`）风格重构命名请求：指令从十条减为三条（约 60 词），加入 `Do not answer the request` 子句，请求体直接引用证据本身；语言通过镜像用户输入实现，而不是大段英文指令；候选先做格式归一化（去引号、去包括 ASCII 句点在内的尾部标点、取第一个分句、强制长度限制），再进入质量与语言门禁，提取函数不再内嵌质量检查。
- 修复两个导致系统性失败的请求参数：移除英文 system-prompt 框架（经同一代理对比裸 `curl` 请求确认，它一直产出英文标题）；把输出预算从 64 提到 2000 token（推理模型的 thinking 被 64-token 预算截断，留下空 body——此前被当作空候选而不是超时）。修复后，经慢代理的第一个 AI 候选直接落为中文标题。
- 空响应会在同一模型上延迟重试一次（等待可取消），并放宽单轮与总预算（75s/90s），使慢 session 模型的首个候选不再被过早放弃；本地回退同样按检测到的语言选择来源轮次。

## [0.7.4] - 2026-11-14

### Changed

- 新增 `doc/GLOSSARY.md`，统一初始命名、结算细化、周期改名、标记与 prompt 行格式等概念的名称与边界；`doc/README.md` 改为带编号的导航式文档入口。
- README 新增 `Project docs` 一节，指向文档索引、Agent 规范与测试入口。

## [0.7.3] - 2026-11-14

### Changed

- 统一代码命名风格：`buildLanguageInstruction`、`MAX_NAME_TOKEN_BUDGET`、枚举值 `"toolResult"`；prompt 行格式 `<tool-result>` 不变，对模型行为无影响。
- 重写 `AGENTS.md`（加入命名约定与零配置边界），把 `doc/README.md` 改成文档导航索引，并同步 `extensions/README.md` 中的导出名。

### Removed

- 移除废弃的旧 `.doc/` 材料（内容已被 `doc/`、`AGENTS.md` 与当前源码取代）；历史仍可在 Git 中查看。

## [0.7.2] - 2026-11-02

### Changed

- 每轮都根据最新的相关任务与结果命名，仅用旧名避免无意义改写。保留已有的十分钟周期冷却与首次结算检查。
- 在六条对话文本之外最多纳入两条近期文本工具结果，同时保留最新的用户目标；先脱敏再取有界头尾片段；工具文本永不参与语言判定或本地回退标签。

### Fixed

- 允许结算命名跟随只在工具结果中出现的结果变化，而不要求新的用户消息或 assistant 重复表述。引用上下文分隔符，使嵌入的工具标记无法冒充另一个 prompt 区块。

## [0.7.1] - 2026-11-02

### Changed

- 要求 Pi / pi-ai `^1.4.0` 与 Node.js `>=22.19.0`；刷新依赖锁文件以匹配已验证的宿主基线。
- 在长工具完成之前，从第一对文本请求/响应在后台生成初始会话名。结算时用已完成任务上下文细化一次，然后保持正常改名冷却。待细化在重载后保留；手动改名会取消后台命名并拒绝过期结果。

### Added

- 默认开启 `titleSpinner` 设置。agent 工作与命名推理期间 TUI 标题动画为 `π - ⠋ - title`，空闲时回到 `π - title`。动画不改变已保存的会话名，也不额外调用模型。
- 独立跟踪 agent 与命名工作、手动改名立即刷新、工作目录回退、控制字符清理，以及取消和 session 关闭/重载时的 timer/abort listener 清理。
- 标题动画的单元与扩展集成覆盖，加上离线 Pi 运行时与终端检查。运行时检查还支持提升后的宿主依赖。
- AI 名称使用显式 `language` locale，`auto` 为默认，无效 locale 安全回到自动检测。回应 #4。
- 可选的 `:minimal` / `:low` / `:medium` / `:high` / `:xhigh` / `:max` 命名模型后缀，改编自 @chuxubank 的 PR #7 以适配当前宿主 `streamSimple` API。

### Fixed

- 把终端标题跟踪与第一响应对话快照整合；加入组合的生命周期与真实 TUI 检查，覆盖早期命名、细化、手动替换、迟到结果与重载。
- 完成一次回退命名后应用正常冷却（包括重载后），而不是每轮都重试整个模型链。
- 即使 `/name` 重复生成的标题也予以执行；只忽略扩展自己的改名回显，包括事件延迟送达的情况。
- 把尚未创建的 session 文件当作正常情况，同时对其他 IO 错误保留安全诊断。
- 从多行模型回复中提取简洁单行，并让 AI/本地回退名称遵守同样的质量限制。改编自 @git-geeky 的 PR #2。

## [0.7.0] - 2026-10-19

### Added

- 新增可选的 `includeCustomMessages` 设置（默认 `false`），把 `custom_message` 条目作为上下文纳入命名 prompt。设为 `true` 包含全部，或设为 `customType` 值数组以白名单形式指定。感谢 [@lmondada](https://github.com/lmondada) 的 [PR #8](https://github.com/ssdiwu/pi-autoname/pull/8)。

### Fixed

- 判断初始对话是否已有历史时忽略无文本的 custom message，避免纯图片或空注入消息从仅含 assistant 的片段触发命名。

- 保留调试诊断，但不记录 session 名、对话文本、session 文件路径或原始异常消息。

- 在命名请求前清理带引号的 JSON 凭据字段（包括转义字符串值），并防止检测到的凭据成为本地回退标题。
- 允许无 Key provider 命名：通过 Pi 配置的模型运行时 `ctx.modelRegistry.streamSimple().result()` 调用，而不再要求 API Key 并使用全局 compat API。已针对 Pi 1.3.0 离线验证。

- 语言检测不再让混入 CJK 用户消息的英文（系统警告、错误日志或 Pi 放进用户轮次的工具输出）压过用户实际的 CJK 意图。包含任意汉字/假名/韩文的用户消息现在一律视为 CJK 语言消息；只有纯拉丁字母的用户消息才计入英文得分。修复近期用户轮次带长英文警告（例如 `pi-di18n` compaction 通知）时周期/`/autoname` 标题翻成英文的问题。

## [0.6.8] - 2026-07-22

### Fixed

- 命名前先从用户编写的自然语言消息检测主导语言；只有用户文本是纯代码或不可用时，才把 pi-di18n 当前 `/lang` locale 作为可选回退。

## [0.6.7] - 2026-07-22

### Fixed

- 自动生成的名称现在遵循用户消息主要使用的语言，而不再被宿主系统 locale 强制。

## [0.6.6] - 2026-07-18

### Changed

- 自动命名现在在 Pi 完全结算的生命周期事件后运行，session 变化时取消过期请求，并把整个模型回退链限制在共享的 30 秒预算内。
- 周期命名把当前标题与近期上下文比较，主题未变时保留原标题；较老的无标记 session 使用近期上下文而不是过时的首次交流。
- 立即观察 `/name` 改动。`respectManualName: true` 现在保留手动标题，直到显式调用 `/autoname`。
- 开发测试现在直接在 TypeScript 上使用 Node.js 内置 `node:test`。移除 Vitest 与全部项目开发依赖。

## [0.6.5] - 2026-06-18

### Added

- 扩展生命周期测试，覆盖 `session_start`、`agent_end`、冷却门控、带外 `/name` 检测与当前 session JSONL 诊断。
- `readSessionFileDiagnostics()` helper，在调试运行期间检查活动 session 文件的最新 `session_info` 与 `pi-autoname-state` 条目。

### Changed

- 测试脚本改用 Vitest 的 `threads` pool，使 `npm test` 在 fork worker 无法启动的环境中也能可靠运行。

## [0.6.2] - 2026-06-08

### Fixed

- 规范化 `package.json` repository 元数据为 npm 期望的标准 Git URL 格式。

## [0.6.1] - 2026-06-08

### Changed

- 刷新 README hero 区，加入封面图、更紧凑的价值主张与居中的安装命令，改善 GitHub/npm 展示。

## [0.6.0] - 2026-06-07

### Changed (breaking)

- **命名状态机重写。** 旧的 `false | "ai" | "fallback" | "manual"` 联合类型替换为清晰的三态模型：`"unnamed" | "named" | "fallback"`。`"manual"` 状态已移除——安装 pi-autoname 后，自动命名接管 session 标题。参见下方 *从 0.5.x 迁移* 说明。
- **`respectManualName` 现在默认 `false`**（原为 `true`）。安装后，`/name` 与 session 选择器改名 UI 仍然可用，但下一次周期改名允许覆盖它们。在配置中设置 `respectManualName: true` 可恢复旧的粘性改名行为。
- **`debug` 现在是唯一的调试开关。** `PI_AUTONAME_DEBUG` 环境变量已移除；在 `~/.pi/agent/pi-autoname.json` 中设置 `debug: true` 查看全部诊断输出，`false` 则静默。

### Added

- **`/name` 宽限期。** session 被带外改名（例如通过 `/name`）后，下一次 `agent_end` 检测到变化，在 session 的 `pi-autoname-state` 条目中记录 `user_rename` 标记，并重置改名冷却。用户的选择随后保留完整的 `cooldownMinutes` 窗口，之后下一次周期改名才会考虑覆盖。
- **新 session 检测。** 只要没有匹配的 `pi-autoname-state` 条目，`session_start` 现在都把 session 视为新 session（`unnamed`）——即使它已经有看起来很高质量的标题（例如从 cwd 目录名派生的系统默认值）。这保证每个此前未命名的 session 都会执行首次对话命名，包括 pi-autoname 安装之前创建的 session。
- **`parseRenameMarker(data)`** 抽取到 `extensions/lib.ts` 并导出。纯函数，新增 7 个单元测试覆盖三种标记形态、畸形数据与缺失时间戳回退。

### Tests

- 52 个通过（原为 43）。新增 7 个 `parseRenameMarker` 用例 + 2 个 `respectManualName` / `DEFAULT_CONFIG` 回归用例。

### Migration from 0.5.x

如果此前依赖 `respectManualName: true`（旧默认值），请在配置里显式设置：

```json
{
  "respectManualName": true
}
```

如果此前使用 `PI_AUTONAME_DEBUG=1` 开启详细日志，请改为在配置中设置 `debug: true`。

## [0.5.13] - 2026-06-01

### Fixed

- 审计发现与代码质量改进。
