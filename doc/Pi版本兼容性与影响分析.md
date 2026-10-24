# Pi 版本兼容性与影响分析

> 记录本扩展实际采用的宿主接口与验证边界，不能仅凭版本号或导入成功认定完整兼容。

## 当前验证基线

- 本机 Pi / pi-ai：`1.4.0`；Node.js：`24.21.0`。
- pi-autoname：`0.7.0`；扩展版本独立于 Pi 版本。
- Pi 在运行时提供对等依赖，项目没有额外开发依赖。
- 历史适配基线包括 Pi `0.80.10` 与 `1.3.0`；本次已在 `1.4.0` 做离线宿主验证，没有重新运行旧版宿主，不声称所有旧版本通过。

## 模型调用与认证

命名统一调用 `ctx.modelRegistry.streamSimple(model, context, options).result()`。由宿主解析当前 provider、认证、请求 headers（请求头）、env（环境）与认证返回的 baseUrl（服务地址），扩展只传递命名上下文、输出 token 上限、取消信号及可选思考级别。

不再从 `@earendil-works/pi-ai/compat` 调用全局 `complete()`，也不再手动提取凭据或要求 `apiKey` 非空。Pi 的合法认证结果可以没有 Key，例如原生无 Key provider；是否授权及如何发送请求由 Pi 模型运行时判断。认证失败仍进入既有模型回退链，全部失败时尝试安全的本地降级名称。

虚拟模型路由、物理模型选择和思考参数转换也由 Pi 的 `streamSimple()` 处理；扩展不维护另一套路由。取消信号通过 Node.js 原生 `AbortSignal.any()` 合并，不再手工注册及清理父信号监听器。

配置模型继续通过 `ctx.modelRegistry.find()` 解析；回退顺序仍为配置主模型、配置回退模型、会话模型，按 provider/modelId 与思考级别的组合去重。已知 `:minimal` / `:low` / `:medium` / `:high` / `:xhigh` / `:max` 后缀转为宿主 `reasoning` 选项；未知后缀保留为模型 ID 的一部分。同模型不同级别可作为不同回退候选，但仍共用总预算。

## 生命周期与命名契约

| Pi 接口或事件 | 本项目行为 |
|---|---|
| `session_start` | 从当前分支的命名 marker（标记）恢复状态与冷却时间 |
| `message_end` | 从首个有效文本请求／回复对提前命名；使用包含尚未持久化回复的快照，不等待工具完成 |
| `agent_settled` | 初始名称修订一次，后续沿用周期冷却；没有提前命名时仍可首次命名，不阻塞主代理收口 |
| `session_info_changed` | 立即识别手工 `/name` 变更，取消后台命名与待完成的收口修订 |
| `session_shutdown` | 取消未完成请求并拒绝迟到结果 |
| `setSessionName()` / `getSessionName()` | 读写会话名称 |
| `appendEntry()` | 保存命名状态，不进入命名对话 |

首个任务最多触发提前命名与收口修订两轮；收口时较新的上下文会替代未完成的初始请求。初始 marker 的可选 `provisional: true` 在 reload 后恢复待完成的修订，旧 marker 的冷却行为不变。工具调用／思考块本身以及失败／取消的回复不触发提前命名。

自动与 `/autoname` 共享命名核心。`language` 为有效 BCP 47 locale 时优先作为 AI 语言要求，默认或非法配置回到 `auto` 检测；本地提取不能翻译文本。AI 正文取首个非空行，仅思考块输出取最后非空行，再与本地降级共用 30 字符上限和质量门禁；这些规则不保证语义质量。单次模型尝试在 12 秒时发出取消信号，所有模型共用 30 秒预算；宿主认证也处于该尝试的取消信号范围。这是协作式取消，依赖宿主及 provider 响应 AbortSignal；若第三方实现忽略取消，不能保证硬性截止。标题仍适用时不重复改写。`respectManualName: true` 保持手工名称，直到显式运行 `/autoname`。

## 隐私边界

发送前先对当前标题和每条对话文本脱敏，再截取每条最多 700 个字符。新增带引号的 JSON 字段识别，包括 `api_key`、`token`、`secret`、`password` 和以 KEY / TOKEN / SECRET / PASSWORD 结尾的字段；完整处理字符串中的空格、转义引号和反斜杠。检测到敏感内容的用户消息不作为本地降级标题来源。

debug 日志仅包含固定状态事件及明确选取的诊断元数据，不输出会话名称、正文、会话文件路径或原始异常信息。会话诊断保留可读性、名称／marker 是否存在、marker 种类和解析错误数；文件诊断仍按整个 JSONL 文件的行序读取，不代表活跃分支状态。宿主惰性建档时的 ENOENT 不报告为错误，其他 IO 故障仍保留固定诊断信号。

这是常见模式匹配，不保证覆盖所有敏感数据或编码形式。`includeCustomMessages` 默认关闭；设为 `true` 时纳入全部自定义消息类型，字符串数组则按 `customType` 精确筛选。匹配且含文本的 `custom_message` 作为用户上下文参与命名、语言判断和窗口计数；`display: false` 不影响纳入，也不绕过共同脱敏和安全降级路径。纯图片或空内容不占最近窗口，也不影响首次对话的历史判定。

## 可复验检查与覆盖

```bash
npm test
PI_HOST_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" node tests/pi-host-smoke.mjs
PI_HOST_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" node tests/pi-early-naming-smoke.mjs
```

- `npm test`：纯函数、命名控制器和真实扩展入口的集成测试；模型运行时由测试替代，检查最终请求与名称／marker 写入。
- 宿主检查：使用已安装 Pi `1.4.0` 的加载器、ExtensionRunner、SessionManager.inMemory、ModelRuntime、ModelRegistry 和官方 faux provider（离线测试模型）。验证无 Key 自动命名、虚拟模型原生路由、`/autoname`、重新加载后的状态恢复、最终请求脱敏、模型失败降级，敏感文本不得作为降级标题、显式语言、思考级别选项、多行／仅思考输出提取和长降级标题。
- 提前命名检查：使用真实 AgentSession 驱动消息持久化、工具执行与收口事件；测试工具等待初始名称出现后才返回，随后验证完整任务上下文产生第二次命名。
- 检查使用临时 HOME、内存凭据与会话，不读取真实凭据，不调用外部模型，不修改个人 Pi 配置；临时 HOME 在结束后清理。
- 未覆盖：真实外部模型、OAuth 登录／刷新、实际交互终端的 `/reload` 操作。宿主重新加载检查不等同于终端人工验收。

## 版本记录

| 日期 | Pi 基线 | 变更 |
|---|---|---|
| 2026-10-23 | `1.4.0` | 首个文本请求／回复对提前命名、收口修订、手工名称竞态保护与真实 AgentSession 离线验证 |
| 2026-10-19 | `1.3.0` | 本地维护候选：移植 #2/#3/#7，增加 #4 显式语言及同入口／宿主回归；未发布 |
| 2026-10-19 | `1.3.0` | 使用宿主模型调用，修复无 Key 限制和 JSON 凭据脱敏，补入口集成与离线宿主验证 |
| 2026-07-18 | `0.80.10` | 对齐生命周期与当时的 compat 兼容入口；该调用路径现已替换 |
| 2026-06-09 | 发布版 | 初版兼容性记录 |
