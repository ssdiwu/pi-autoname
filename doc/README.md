# pi-autoname 文档入口

1. [用户说明与配置](../README.md)
2. [Agent 规范](../AGENTS.md)
3. [术语表](./术语表.md)
4. [实现说明](../extensions/README.md)
5. [测试入口](../tests/README.md)
6. [证据与历史归档](./references/)

`doc/术语表.md` 是概念名称与边界的唯一正文；本目录不维护第二份现行机制正文——现行行为与配置以 [根 README](../README.md)、[extensions/README](../extensions/README.md) 与实现为准。`doc/references/` 只保存来源、验证证据与历史阶段记录，不作为并行需求或现行实现权威。

## 现行正文（不在本目录）

| 位置 | 内容 |
|---|---|
| [`../README.md`](../README.md) | 用户可感知行为、配置字段、安装与开发方式 |
| [`../AGENTS.md`](../AGENTS.md) | 长期工程、隐私与交付边界 |
| [`../extensions/README.md`](../extensions/README.md) | 实现说明：模块职责、导出与测试对应关系 |
| [`../tests/README.md`](../tests/README.md) | 各验证入口能证明什么 |

## 术语

- [术语表.md](./术语表.md)：初名、收口修订、周期改名、marker、提示词线格式等概念的名称与边界。

## 证据与历史（`doc/references/`）

只保存来源、验证记录与历史阶段，不维护第二份现行正文：

| 文件 | 内容 |
|---|---|
| [Pi版本兼容性与影响分析.md](./references/Pi版本兼容性与影响分析.md) | 逐版本兼容性与验证记录，含证据边界声明；不是现行权威规格 |
| [mechanism-discussion.md](./references/mechanism-discussion.md) | 2026-11-14 触发链、0 配置决策与命名统一讨论留档 |
| [project-structure.md](./references/project-structure.md) | 项目结构快照，已过时，仅供历史追溯 |
| [review-fix-report.md](./references/review-fix-report.md) | 2026-05-31 代码审查与修复报告，来源与修复证据 |

本机原始现场（截图、日志、抓取输出）放仓库根 `.artifacts/`，已被 Git 忽略；引用它不表示文件随仓库分发。

## 维护规则

- 概念命名变化 → 更新 `doc/术语表.md`；用户可感知行为变化 → 更新根 `README.md` 与 `CHANGELOG.md`。
- 兼容性证据 → 追加 `doc/references/Pi版本兼容性与影响分析.md`，不据此改写现行行为表述。
- 难逆转决定 → 后续如需立档，在 `doc/决策档案/` 下按 `0001-中文标题.md` 一条一文件并同步索引；可复用做法 → `doc/经验笔记.md`。
