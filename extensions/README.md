# extensions/

pi-autoname 的核心逻辑所在。

## 文件说明

| 文件 | 职责 |
|------|------|
| `index.ts` | Pi Extension（扩展）入口：注册生命周期事件、`/autoname` 命令、宿主 `modelRegistry.streamSimple().result()` 模型调用、命名请求总预算，以及当前 session JSONL（会话日志）的调试诊断 |
| `lib.ts` | 纯工具函数：用户消息语言检测、配置规范化、敏感信息脱敏、名称质量检查、尾部对话提取、降级命名 |
| `title-spinner.ts` | TUI-only `π - marker - title` animation; independent agent/naming activity, safe title formatting, cancellation and timer cleanup |

## 关键导出

### index.ts（默认导出）

```typescript
export default function extension(pi: ExtensionAPI): void
```

注册以下能力：
- `session_start`（会话启动）— 恢复命名状态，并在 debug 模式记录 session JSONL 诊断
- `session_info_changed`（会话名称变更）— 立即识别 `/name`，写入手工名称 marker
- `before_agent_start` / `agent_start` — start the terminal-title marker in TUI mode
- `agent_settled`（代理完全稳定）— 后台触发首次或周期命名，不阻塞主代理收口；clear agent activity while independently tracking any naming request
- `session_shutdown`（会话关闭）— 取消未完成命名请求，dispose the title spinner and its abort listeners/timers
- `/autoname`（手动命令）— 显式触发一次命名，即使 `respectManualName` 已启用

命名导出：
- `readSessionFileDiagnostics(sessionFile)` — 读当前 session JSONL，返回最新的 `session_info` 和 `pi-autoname-state` marker。**按文件行序取最后一个**，不区分 branch；Pi 会话是树结构，`.jsonl` 含所有 branch 的 entry，所以诊断里的“最新名”可能来自非活跃分支，仅用于排障。惰性会话文件尚未创建（ENOENT）不计为诊断错误，其他 IO 错误仍保留固定诊断信号。该导出仍返回名称和路径，调用者不得将原始返回对象直接写入日志；扩展 debug 只输出可读性、名称／marker 是否存在、marker 种类和解析错误数。运行时命名决策以 `getBranch()` 为准，不用这个 helper。
- `SessionFileDiagnostics` — 返回值类型

### lib.ts（命名导出）

纯函数：
- `detectDominantUserLanguage(parts)` — 仅按用户自然语言消息判定中文、英文、日文或韩文主语言
- `getNamingLanguageInstruction(parts, fallbackLocale, explicitLanguage)` — 生成显式语言提示；显式 language 优先，其次用户语言，无可判定用户语言时才采用可选 locale 兜底
- `normalizeConfig(input)` — 配置规范化，包括 BCP 47 语言配置（非法值回到 auto）
- `parseModelRef(modelName)` — 解析 provider/modelId 与六种思考级别后缀，未知后缀保留
- `limitNameLength(text)` — AI／本地降级共用 30 字符上限，优先保留完整单词，不切断 UTF-16 代理对
- `getDialogueOptions(includeCustomMessages)` — 按 `includeCustomMessages` 生成 `custom_message` 过滤选项（关闭 / 全部 / `customType` 白名单）
- `redactSensitiveText(text)` — 敏感信息脱敏
- `isHighQualityName(name)` — 名称质量检查
- `blockText(content)` — 从消息 content 抽纯文本
- `smartFallbackName(text)` — 降级命名生成
- `parseRenameMarker(data)` — 解析 `pi-autoname-state` entry 的 marker
- `getFirstDialogue(branch, options)` / `getRecentDialogue(branch, max, options)` / `getInitialDialogue(branch, options)` — 对话提取；启用时匹配的 `custom_message` 以 user 身份按时间顺序参与

常量：`DEFAULT_CONFIG`、`MIN_NAME_LENGTH`、`MAX_NAME_LENGTH`、`RAW_SLICE_RE`、`SENTENCE_END_RE`、`MIN_COOLDOWN_MINUTES`、`MAX_COOLDOWN_MINUTES`、`SENSITIVE_PATTERNS`

类型：`AutonameConfig`、`DialogueOptions`、`RenameMarker`

## 测试

```bash
npm test
```

`npm test` 使用 Node.js（JavaScript 运行时）内置的 `node:test`（测试 API）直接执行 TypeScript（类型脚本），不需要 Vitest（测试框架）或 Bun（运行时）。

测试文件位于：
- `../tests/pi-autoname.test.ts` — `lib.ts` 纯函数
- `../tests/extension-lifecycle.test.ts` — `controller.ts` 生命周期、冷却与取消
- `../tests/extension-integration.test.ts` — `index.ts` 入口、最终请求脱敏、无 Key 调用、降级及恢复
- `../tests/pi-host-smoke.mjs` — 本机 Pi 加载器、运行时与内存会话的离线检查，运行方法见 `../doc/Pi版本兼容性与影响分析.md`
- `../tests/title-spinner.test.ts` — title animation, overlapping activity, cancellation and stale callbacks
- `../tests/pi-tui-smoke.py` — actual offline TUI title output and `/reload`/Escape lifecycle
