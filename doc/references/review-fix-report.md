# 代码审查与修复报告

日期：2026-05-31

> 历史审查证据，非现行规格。所涉代码与行为已被后续版本取代，现行行为见 [根 README](../../README.md)。

## 审查范围

- `extensions/index.ts`
- `package.json`
- `README.md`
- npm 发包内容验证

## 已修复问题

### 1. 🟡 动态模型解析失败

- 位置：`extensions/index.ts`
- 原问题：配置中的 `provider/model` 使用全局 `getModel()`，可能无法识别运行时通过 pi provider registry 注册的模型。
- 修复：`resolveModelFromString()` 改为优先使用 `ctx.modelRegistry.find(provider, modelId)`，再 fallback 到 `getModel()`。

### 2. 🟡 超时不取消底层 AI 请求

- 位置：`extensions/index.ts`
- 原问题：`Promise.race()` 超时只结束外层等待，底层 `complete()` 仍可能继续运行。
- 修复：使用 `AbortController`，并把 `signal` 传给 `complete()`；超时、父级取消都会 abort 底层请求，同时清理 timeout 和事件监听。

### 3. 🟡 对话片段可能泄露敏感信息

- 位置：`extensions/index.ts`, `README.md`
- 原问题：自动命名会发送最近对话给模型，若对话包含 token/API key 可能泄露。
- 修复：新增敏感信息脱敏，覆盖常见 API key、Bearer token、AWS key、private key、`*_TOKEN`/`*_SECRET`/`*_PASSWORD` 等模式；fallback 命名在检测到敏感内容时跳过。README 增加隐私说明。

### 4. 🟡 配置缺少 schema/范围校验

- 位置：`extensions/index.ts`
- 原问题：配置类型错误或 `cooldownMinutes <= 0` 可能导致运行异常、每轮重命名或周期命名失效。
- 修复：新增 `normalizeConfig()`，校验字段类型，过滤非法 fallback model，并将 `cooldownMinutes` 限制在 `1..1440` 分钟。

### 5. 🟡 手动 session name 可能被周期任务覆盖

- 位置：`extensions/index.ts`, `README.md`
- 原问题：扩展无法区分用户通过 `/name` 设置的名称和扩展生成的名称。
- 修复：新增 `pi-autoname-state` session entry 记录扩展生成的名称和来源；`session_start` 如果发现已有名称不是扩展持久化记录，默认视为 manual，不自动覆盖。新增配置 `respectManualName`，默认 `true`。

### 6. 🟡 配置读取失败静默降级

- 位置：`extensions/index.ts`
- 原问题：JSON 损坏、权限失败等异常被吞掉。
- 修复：配置目录不存在时自动创建；读取失败时输出明确错误并使用默认配置。

### 7. 🔵 并发命名结果可能乱序覆盖

- 位置：`extensions/index.ts`
- 原问题：自动命名与 `/autoname` 并发时，较早请求可能后完成并覆盖新名称。
- 修复：新增 `namingSequence`，只允许最新请求应用 `setSessionName()`。

### 8. 🔵 AI 输出质量校验不统一

- 位置：`extensions/index.ts`
- 原问题：AI 输出清洗后未复用统一质量判断。
- 修复：AI 结果统一走 `isHighQualityName()`。

## 验证结果

- `npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck extensions/index.ts`：通过。
- `npm pack --dry-run`：通过，tarball 只包含 4 个文件。
- `npm test`：未通过，原因是当前仓库没有任何测试文件（`No test files found`）。

## 发包确认

`.doc/` 不参与发包：`package.json#files` 是显式白名单，只包含：

```json
["extensions/", "README.md", "LICENSE", "package.json"]
```

已通过 `npm pack --dry-run` 验证 tarball 内容不包含 `.doc/`。

## 残留事项

### 补充：抽取纯函数 + 新增测试

- 位置：`extensions/lib.ts`, `tests/pi-autoname.test.ts`
- 变更：将纯工具函数（`normalizeConfig`, `redactSensitiveText`, `isHighQualityName`, `blockText`, `smartFallbackName`, `getFirstDialogue`, `getRecentDialogue`）抽取到 `extensions/lib.ts`，使单测可直接导入。
- 新增 43 个 vitest 测试，覆盖所有纯函数。
- 验证：`npm test` 全部通过。
