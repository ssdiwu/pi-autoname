# extensions/

pi-autoname 的核心逻辑所在。

## 文件说明

| 文件 | 职责 |
|------|------|
| `index.ts` | Extension 入口：注册 Pi 生命周期事件、`/autoname` 命令、模型调用、语言提示，以及基于当前 session JSONL 的调试诊断 |
| `controller.ts` | 命名状态机：恢复 marker、即时识别手动改名、取消过时请求、冷却控制和 session shutdown |
| `lib.ts` | 纯工具函数：配置规范化、敏感信息脱敏、名称质量检查、语言检测、compaction-aware 对话提取、降级命名 |

## 关键导出

### index.ts（默认导出）

```typescript
export default function extension(pi: ExtensionAPI): void
```

注册以下能力：
- `session_start` 事件 — 恢复命名状态，并在 debug 模式下记录当前 session JSONL 的最新显示名 / marker 诊断
- `session_info_changed` 事件 — 即时记录用户通过 `/name` 或 UI 设置的名称
- `agent_settled` 事件 — 首次对话自动命名 + 周期性重命名
- `session_shutdown` 事件 — 取消进行中的命名请求
- `/autoname` 命令 — 手动触发 AI 命名

命名导出：
- `readSessionFileDiagnostics(sessionFile)` — 读当前 session JSONL，返回最新的 `session_info` 和 `pi-autoname-state` marker。**按文件行序取最后一个**，不区分 branch；Pi 会话是树结构，`.jsonl` 含所有 branch 的 entry，所以诊断里的“最新名”可能来自非活跃分支，仅用于 debug 排障。运行时命名决策以 `getBranch()` 为准，不用这个 helper。
- `SessionFileDiagnostics` — 返回值类型

### lib.ts（命名导出）

纯函数：
- `normalizeConfig(input)` — 配置规范化；`respectManualName` 默认是 `true`
- `redactSensitiveText(text)` — 敏感信息脱敏
- `isHighQualityName(name, maxNameLength?)` — 名称质量检查
- `blockText(content)` — 从消息 content 抽纯文本
- `smartFallbackName(text)` — 降级命名生成
- `parseRenameMarker(data)` — 解析 `pi-autoname-state` entry 的 marker
- `extractTicketPrefix(parts, ticketPattern)` / `withTicketPrefix(name, ticketPrefix)` — 可配置工单前缀提取与去重
- `getFirstDialogue(branch)` / `getRecentDialogue(branch)` / `getNamingContext(branch)` — 对话和 compaction 上下文提取
- `detectDominantUserLanguage(parts)` / `getNamingLanguageInstruction(parts, fallbackLocale?)` — 从用户消息推断命名语言
- `shouldRunAutomaticRename(respectManualName, currentNameKind)` — 根据 `respectManualName` 和当前名称标记判断是否允许自动重命名；启用该策略时，跳过带有 `user_rename` 标记的名称。

常量：`DEFAULT_CONFIG`、`MIN_NAME_LENGTH`、`MAX_NAME_LENGTH`、`MIN_CONFIG_NAME_LENGTH`、`MAX_CONFIG_NAME_LENGTH`、`RAW_SLICE_RE`、`SENTENCE_END_RE`、`MIN_COOLDOWN_MINUTES`、`MAX_COOLDOWN_MINUTES`、`SENSITIVE_PATTERNS`

类型：`AutonameConfig`、`RenameMarker`

## 测试

Проверки выполняются в следующем порядке: сначала тесты, затем проверка типов。

```bash
npm test
npm run typecheck
```

测试文件位于：
- `../tests/pi-autoname.test.ts` — `lib.ts` 纯函数
- `../tests/extension-lifecycle.test.ts` — `index.ts` 生命周期、冷却时间、手工改名检测、session 文件诊断
