# pi-autoname 项目构成

> 历史快照，已过时：文中触发时机与目录描述早于 0.7.1 提前命名改造，仅供历史追溯。现行结构见 [根 README](../../README.md) 的 Project docs 与 [extensions/README](../../extensions/README.md)。

## 发包入口

- `package.json`：npm 元信息、Pi package manifest（包清单）与发包白名单。
- `index.ts`：转发至 `extensions/index.ts` 的 npm / Pi 入口。
- `extensions/index.ts`：Pi Extension（扩展）入口，负责配置、模型调用、事件注册与 `/autoname`。
- `extensions/controller.ts`：无 Pi 依赖的命名状态控制器。
- `extensions/lib.ts`：无副作用的配置、脱敏、对话提取和降级命名函数。

npm tarball（发布包）只包含 TypeScript、公开文档、许可证和元数据；`.doc/` 与 `tests/` 不发布。

## 运行流程

1. `session_start` 恢复当前分支的 `pi-autoname-state` marker（标记）。
2. `session_info_changed` 立即记录外部 `/name` 变更。
3. `agent_settled` 后后台考虑首次或周期命名；名称稳定时不重写。
4. `session_shutdown` 中止未完成请求。
5. `/autoname` 强制运行一次命名，可覆盖 sticky（固定）手工名称。

## 开发与测试

- 扩展实现使用 TypeScript（类型脚本），离线宿主检查使用 Node.js 的 `.mjs` 脚本；不增加 Python 或 Bun 依赖。
- `npm test` 调用 Node.js（JavaScript 运行时）内置的 `node:test`（测试 API）。
- Pi 在扩展运行时提供 `@earendil-works/pi-ai` 和 `@earendil-works/pi-coding-agent` peer dependency（对等依赖）；项目不声明其他运行或开发依赖。

## 本地忽略文件

`.gitignore`（Git 忽略规则）排除 `node_modules/`、`dist/`、`*.tsbuildinfo`、`.diwu/` 和 `.dteam/`。发布内容由 `package.json#files` 白名单决定。
