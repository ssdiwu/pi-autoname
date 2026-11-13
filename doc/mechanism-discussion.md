# pi-autoname 机制讨论

```mermaid
flowchart TD
    subgraph trigger["触发时机"]
        A["首个文本请求/响应对<br/>（message_end）"] --> B["后台初名"]
        C["agent_settled<br/>首个落定"] --> D["复核初名<br/>（绕过冷却，仅一次）"]
        E["agent_settled<br/>后续每次"] --> F{"距上次改名<br/>≥ cooldownMinutes？"}
        F -- 否 --> G["跳过"]
        F -- 是 --> H["模型判断：话题变了吗"]
        M["/autoname 手动"] --> N["强制重命名"]
        K["/name 手动"] --> L["给一个冷却期宽限<br/>respectManualName=true 则永久保留"]
    end

    B --> I
    D --> I
    H --> I
    N --> I

    subgraph chain["模型链（共享 30 秒预算）"]
        I["model 配置"] --> J["fallbackModels 依次"]
        J --> O["会话模型"]
        O --> P["本地文本提取<br/>（无 AI）"]
    end

    P --> Q["质量门（长度/句式）"]
    Q --> R["写入会话名<br/>+ 终端标题"]
```

## 对照你的三点设想

| 设想 | 现状 | 判断 |
|---|---|---|
| ① 简洁拓展、重命名会话 | 纯拓展，`pi install` 即用 | ✅ 满足 |
| ② 不指定模型，只用主模型 | 默认就用会话模型；但多出 `model`/`fallbackModels` 两个配置 | ⚠️ 可精简，见下 |
| ③ 命令最小化 | 仅 1 个自有命令 `/autoname` | ✅ 满足 |

## 关于第②点的建议

**保留现状（可选模型配置）更好**，理由是成本其实很低：

- 不配置时行为就是「只用主模型」，零配置目标已达成——README 第一句就是 "Works out of the box"
- `model`/`fallbackModels` 只影响命名这一件事，风险低；命名模型跑挂了也只是退回文本提取，不伤主任务
- 命名是高频小请求，有人愿意用便宜小模型跑（如 MiniMax 而非主推理模型），砍掉这条通道等于逼他们换会话模型或放弃省钱

**折中方案**：如果觉得「多一个配置文件麻烦」是痛点，可以不删字段，而是弱化文档上的存在感——README 配置节把 `model`/`fallbackModels` 折叠进「高级：模型 fallback 链」小节，主线叙事只讲「什么都不配就行」。机制不变，认知负担降下来。

## 命令清单（第③点）

- `/autoname` — 唯一自有命令：从当前上下文强制重命名
- `/name` — Pi 内置命令，不是本拓展注册的；本拓展只是**观察**它产生的名字并给宽限期
- `/reload` — 改配置后生效（`titleSpinner`、`enabled` 等需重载）

命令面已经最小：自有命令只有 `/autoname` 一个。配置文件本身也是首次使用自动生成的，用户可以一辈子不看它。
