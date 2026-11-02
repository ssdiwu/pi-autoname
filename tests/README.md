# tests/

pi-autoname 的测试目录。

## 文件说明

| 文件 | 职责 |
|---|---|
| `pi-autoname.test.ts` | `extensions/lib.ts` 纯函数测试：配置、脱敏、名称质量、尾部对话提取、marker 解析 |
| `extension-lifecycle.test.ts` | `extensions/controller.ts` 生命周期测试：首次/周期命名、手工名称保护、稳定标题、请求替换与关闭取消 |
| `extension-integration.test.ts` | 临时 HOME 中执行真实扩展入口，验证无 Key 调用、最终请求脱敏、降级与 reload 状态 |
| `pi-host-smoke.mjs` | 可选的本机 Pi 离线宿主检查，使用真实加载器、运行时与内存会话 |
| `title-spinner.test.ts` | Terminal-title formatting, animation, overlap, cancellation, cleanup and stale callbacks |
| `pi-tui-smoke.py` | Optional real Pi TUI/PTY test with an offline faux provider (Linux/macOS, Python 3) |

## 运行

```bash
npm test
```

测试只使用 Node.js（JavaScript 运行时）内置的 `node:test`（测试 API）；Node.js 22.6 及以上可直接执行本目录的 TypeScript（类型脚本）测试。

终端标题功能已在 Pi 1.4.0 验证（此前基线为 1.3.0）。宿主检查单独运行，不计入 `npm test`：

```bash
PI_HOST_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" node tests/pi-host-smoke.mjs
```

该检查仅使用临时 HOME、内存凭据和官方 faux provider，不连接真实模型；不会更改个人配置或会话。宿主加载与事件调用不等同于终端人工操作验收。

## Terminal smoke test

```bash
PI_HOST_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" python3 tests/pi-tui-smoke.py
```

This starts the actual interactive CLI inside a pseudo-terminal and captures OSC title sequences. It verifies multiple animation frames, normal completion, no idle polling, manual `/name`, `/reload`, Escape cancellation and clean shutdown. It uses a temporary HOME, an isolated environment, no persisted session, and Pi's built-in offline faux provider. It does not connect to a real model or verify how a particular graphical terminal renders its tab bar.

The TypeScript integration tests also check TUI-only behavior (including RPC with `hasUI: true`), disabled animation, manual-name protection, naming failure, overlap, and late results after session replacement.
