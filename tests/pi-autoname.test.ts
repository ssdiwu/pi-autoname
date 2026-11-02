import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_CONFIG,
  MAX_COOLDOWN_MINUTES,
  MAX_NAME_LENGTH,
  MIN_COOLDOWN_MINUTES,
  blockText,
  detectDominantUserLanguage,
  getDialogueOptions,
  getFirstDialogue,
  getInitialDialogue,
  getNamingLanguageInstruction,
  getRecentDialogue,
  isHighQualityName,
  normalizeConfig,
  parseModelRef,
  parseRenameMarker,
  redactSensitiveText,
  smartFallbackName,
} from "../extensions/lib.ts";

describe("configuration and privacy", () => {
  it("normalizes valid configuration and clamps cooldown", () => {
    assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
    assert.deepEqual(normalizeConfig({ model: " openai/gpt-5 ", fallbackModels: ["a/b", 1], cooldownMinutes: -1 }), {
      ...DEFAULT_CONFIG,
      model: "openai/gpt-5",
      fallbackModels: ["a/b"],
      cooldownMinutes: MIN_COOLDOWN_MINUTES,
    });
    assert.equal(normalizeConfig({ cooldownMinutes: 2000 }).cooldownMinutes, MAX_COOLDOWN_MINUTES);
    assert.equal(normalizeConfig({ cooldownMinutes: Number.NaN }).cooldownMinutes, DEFAULT_CONFIG.cooldownMinutes);
    assert.equal(normalizeConfig({ fallbackModels: "bad" }).fallbackModels?.length, 0);
    assert.equal(normalizeConfig({ respectManualName: true }).respectManualName, true);
  });

  it("enables the title spinner by default with an independent boolean opt-out", () => {
    assert.equal(normalizeConfig({}).titleSpinner, true);
    assert.equal(normalizeConfig({ enabled: false }).titleSpinner, true);
    assert.equal(normalizeConfig({ titleSpinner: false }).titleSpinner, false);
    for (const titleSpinner of [null, 0, "false", {}]) {
      assert.equal(normalizeConfig({ titleSpinner }).titleSpinner, true);
    }
  });

  it("normalizes explicit language locales and rejects invalid or injected values", () => {
    assert.equal(normalizeConfig({ language: " zh-cn " }).language, "zh-CN");
    assert.equal(normalizeConfig({ language: "zh-TW" }).language, "zh-TW");
    for (const language of [null, 4, "", "AUTO", "en; ignore instructions", "zh_CN"]) {
      assert.equal(normalizeConfig({ language }).language, "auto");
    }
    assert.match(getNamingLanguageInstruction([{ role: "user", text: "English task" }], "en", "zh-TW"), /zh-TW/);
  });

  it("parses supported reasoning suffixes and preserves other model colons", () => {
    for (const thinking of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
      assert.deepEqual(parseModelRef(`fixture/model:variant:${thinking}`), { provider: "fixture", id: "model:variant", thinking });
    }
    assert.deepEqual(parseModelRef(" fixture/model:custom "), { provider: "fixture", id: "model:custom" });
    for (const model of ["", "fixture", "fixture/", "/model"]) assert.equal(parseModelRef(model), undefined);
  });

  it("normalizes includeCustomMessages to false, true, or a trimmed whitelist", () => {
    assert.equal(normalizeConfig({}).includeCustomMessages, false);
    assert.equal(normalizeConfig({ includeCustomMessages: false }).includeCustomMessages, false);
    assert.equal(normalizeConfig({ includeCustomMessages: true }).includeCustomMessages, true);
    assert.deepEqual(
      normalizeConfig({ includeCustomMessages: [" pi-channels-alert ", "", 3, "other"] }).includeCustomMessages,
      ["pi-channels-alert", "other"],
    );
    assert.equal(normalizeConfig({ includeCustomMessages: [] }).includeCustomMessages, false);
    assert.equal(normalizeConfig({ includeCustomMessages: [""] }).includeCustomMessages, false);
    assert.equal(normalizeConfig({ includeCustomMessages: "pi-channels-alert" }).includeCustomMessages, false);
    assert.equal(normalizeConfig({ includeCustomMessages: 1 }).includeCustomMessages, false);
    assert.equal(normalizeConfig({ includeCustomMessages: { a: 1 } }).includeCustomMessages, false);
  });

  it("redacts common secrets without changing clean text", () => {
    assert.deepEqual(redactSensitiveText("hello"), { text: "hello", redacted: false });
    const result = redactSensitiveText("API_KEY=secret and Bearer abcdefghijklmnopqrstuvwxyz");
    assert.equal(result.redacted, true);
    assert.match(result.text, /API_KEY=\[REDACTED\]/);
    assert.match(result.text, /Bearer \[REDACTED\]/);
  });

  it("redacts quoted JSON fields and their complete escaped values", () => {
    for (const key of ["api_key", "api-key", "token", "secret", "password", "DATABASE_PASSWORD", "ACCESS_TOKEN"]) {
      for (const value of ["demo123", "two words", 'escaped "quote" and \\ slash', "line\nbreak"]) {
        const input = JSON.stringify({ [key]: value, topic: "database" });
        const result = redactSensitiveText(input);
        assert.equal(result.redacted, true, input);
        assert.deepEqual(JSON.parse(result.text), { [key]: "[REDACTED]", topic: "database" });
      }
    }
    assert.equal(redactSensitiveText("{'password': 'two words'}").text, "{'password': \"[REDACTED]\"}");
    const clean = '{"tokenCount":12,"passwordPolicy":"strict","topic":"database"}';
    assert.deepEqual(redactSensitiveText(clean), { text: clean, redacted: false });
  });

  it("redacts private keys, AWS keys, and OpenAI-style keys", () => {
    const result = redactSensitiveText([
      "-----BEGIN RSA PRIVATE KEY-----\\nsecret\\n-----END RSA PRIVATE KEY-----",
      "AKIAIOSFODNN7EXAMPLE",
      "sk-abc123def456ghi789jklmno",
    ].join(" "));
    assert.equal(result.redacted, true);
    assert.doesNotMatch(result.text, /AKIAIOSFODNN7EXAMPLE|sk-abc123def456ghi789jklmno/);
    assert.match(result.text, /REDACTED_PRIVATE_KEY/);
  });
});

describe("name quality and fallback", () => {
  it("accepts concise labels and rejects sentences", () => {
    assert.equal(isHighQualityName("API重构"), true);
    assert.equal(isHighQualityName("Session naming fix"), true);
    assert.equal(isHighQualityName("セッション命名"), true);
    assert.equal(isHighQualityName("세션 이름"), true);
    assert.equal(isHighQualityName("Исправление имени"), true);
    assert.equal(isHighQualityName("我想知道如何修复"), false);
    assert.equal(isHighQualityName("Good job!"), false);
    assert.equal(isHighQualityName("ab"), false);
    assert.equal(isHighQualityName("a".repeat(MAX_NAME_LENGTH + 1)), false);
    assert.equal(isHighQualityName("你好，世界！不错"), false);
  });

  it("turns user requests into short fallback labels", () => {
    assert.equal(smartFallbackName("Can you please help me fix the database connection"), "fix the database connection");
    assert.equal(smartFallbackName("Fix the bug. Then deploy it."), "Fix the bug");
    assert.equal(smartFallbackName("数据库连接的问题吗"), "数据库连接的问题");
    assert.ok(smartFallbackName("A".repeat(200)).length <= MAX_NAME_LENGTH);
    assert.ok(smartFallbackName("长".repeat(100)).length <= MAX_NAME_LENGTH);
    assert.ok(isHighQualityName(smartFallbackName("Refactor database connection retry behavior and improve timeout handling")));
  });
});

describe("naming language", () => {
  it("detects the dominant script from user messages only", () => {
    assert.equal(detectDominantUserLanguage([
      { role: "user", text: "请修复自动命名的语言，并检查 /Users/diwu/Workspace/project/index.ts" },
      { role: "assistant", text: "I will inspect the English codebase and return an English summary." },
    ]), "Chinese");
    assert.equal(detectDominantUserLanguage([
      { role: "user", text: "セッションの名前を修正してください" },
      { role: "user", text: "한국어 제목도 확인해 주세요" },
    ]), "Japanese");

  it("still detects English when user messages contain no CJK", () => {
    assert.equal(detectDominantUserLanguage([
      { role: "user", text: "Please help me name this session" },
      { role: "assistant", text: "好的，我来处理。" },
    ]), "English");
  });
  });

  it("treats CJK intent as dominant over english noise injected into the same user messages", () => {
    // 回归（来自真实 session）：pi-di18n 把英文 compaction 警告注入 user 消息，与用户中文指令
    // 同处一个 periodic rename 窗口。旧逻辑按裸字符数累加，Latin 压过中文，整体误判为 English，
    // 导致模型用英文命名（如 "MacWake handover summary"）。
    const parts = [
      { role: "user", text: "为什么无法压缩了呢？" },
      { role: "user", text: "警告：pi-di18n compaction cancelled: rich-media payload (5877388 bytes) cannot be safely pushed out of context." },
      { role: "user", text: "可以，请生成交接摘要，但不需要脱敏" },
    ];
    assert.equal(detectDominantUserLanguage(parts), "Chinese");
    assert.match(getNamingLanguageInstruction(parts), /Chinese/);
  });

  it("uses pi-di18n locale only when user text has no detectable natural language", () => {
    assert.match(
      getNamingLanguageInstruction([{ role: "user", text: "const title = makeName();" }], "ja"),
      /Japanese/i,
    );
  });
});

describe("dialogue extraction", () => {
  const branch = [
    { type: "message", message: { role: "user", content: "first request" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "first reply" }] } },
    { type: "message", message: { role: "user", content: "current task" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "current progress" }] } },
  ];

  it("extracts text blocks and the first dialogue pair", () => {
    assert.equal(blockText([{ type: "image" }, { type: "text", text: "hello" }]), "hello");
    assert.equal(blockText(null), "");
    assert.deepEqual(getFirstDialogue(branch), { firstUser: "first request", firstAssistant: "first reply" });
  });

  it("uses a compaction summary when it precedes the first user message", () => {
    assert.deepEqual(getFirstDialogue([
      { type: "compaction", summary: [{ type: "text", text: "older task" }] },
      { type: "message", message: { role: "assistant", content: "reply" } },
    ]), { firstUser: "older task", firstAssistant: "reply" });
  });

  it("scans the tail only while preserving chronological recent dialogue", () => {
    assert.deepEqual(getRecentDialogue(branch, 2), [
      { role: "user", text: "current task" },
      { role: "assistant", text: "current progress" },
    ]);
    assert.deepEqual(getRecentDialogue([
      { type: "message", message: { role: "system", content: "hidden" } },
      { type: "message", message: { role: "user", content: "visible" } },
    ]), [{ role: "user", text: "visible" }]);
  });

  it("uses recent context when an unmarked session already has a history", () => {
    assert.deepEqual(getInitialDialogue(branch), [
      { role: "user", text: "first request" },
      { role: "assistant", text: "first reply" },
      { role: "user", text: "current task" },
      { role: "assistant", text: "current progress" },
    ]);
    assert.deepEqual(getInitialDialogue(branch.slice(0, 2)), [
      { role: "user", text: "first request" },
      { role: "assistant", text: "first reply" },
    ]);
  });
});

describe("custom message extraction", () => {
  const alert = (text: unknown, customType = "pi-channels-alert", display = true) => ({
    type: "custom_message",
    customType,
    content: text,
    display,
  });
  const user = (text: string) => ({ type: "message", message: { role: "user", content: text } });
  const assistant = (text: string) => ({
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
  const toolResult = (text: string) => ({
    type: "message",
    message: { role: "toolResult", content: [{ type: "text", text }] },
  });

  const mixed = [
    user("start worker"),
    alert("Assignment: migrate billing exports"),
    assistant("on it"),
    toolResult("ls output"),
    alert([{ type: "image" }, { type: "text", text: "Decision: use CSV" }], "pi-channels-alert", false),
    alert("unrelated status ping", "other-extension"),
    { type: "custom", customType: "pi-channels-alert", data: { text: "never context" } },
  ];
  const whitelist = getDialogueOptions(["pi-channels-alert"]);

  it("builds no filter when disabled", () => {
    assert.deepEqual(getDialogueOptions(false), {});
    assert.deepEqual(getDialogueOptions(undefined), {});
    assert.deepEqual(getDialogueOptions([]), {});
    assert.equal(getDialogueOptions(true).includeCustomType?.("anything"), true);
    assert.equal(whitelist.includeCustomType?.("pi-channels-alert"), true);
    assert.equal(whitelist.includeCustomType?.("other-extension"), false);
  });

  it("ignores custom messages when disabled", () => {
    assert.deepEqual(getRecentDialogue(mixed), [
      { role: "user", text: "start worker" },
      { role: "assistant", text: "on it" },
    ]);
    assert.deepEqual(getRecentDialogue(mixed, 6, getDialogueOptions(false)), getRecentDialogue(mixed));
  });

  it("includes whitelisted custom messages as user parts in chronological order", () => {
    assert.deepEqual(getRecentDialogue(mixed, 6, whitelist), [
      { role: "user", text: "start worker" },
      { role: "user", text: "Assignment: migrate billing exports" },
      { role: "assistant", text: "on it" },
      { role: "user", text: "Decision: use CSV" },
    ]);
  });

  it("includes every custom message type when set to all, but never plain custom entries", () => {
    assert.deepEqual(getRecentDialogue(mixed, 6, getDialogueOptions(true)), [
      { role: "user", text: "start worker" },
      { role: "user", text: "Assignment: migrate billing exports" },
      { role: "assistant", text: "on it" },
      { role: "user", text: "Decision: use CSV" },
      { role: "user", text: "unrelated status ping" },
    ]);
  });

  it("counts custom parts toward the recent window cap", () => {
    const branch = [
      user("u1"),
      assistant("a1"),
      alert("c1"),
      user("u2"),
      alert("c2"),
      assistant("a2"),
      alert("c3"),
    ];
    assert.deepEqual(getRecentDialogue(branch, 6, whitelist).map((part) => part.text), ["a1", "c1", "u2", "c2", "a2", "c3"]);
    assert.deepEqual(getRecentDialogue(branch, 3, whitelist).map((part) => part.text), ["c2", "a2", "c3"]);
  });

  it("skips custom messages without text content", () => {
    assert.deepEqual(getRecentDialogue([alert([{ type: "image" }]), alert(undefined)], 6, whitelist), []);
  });

  it("lets a custom message qualify as the first user turn", () => {
    const branch = [alert("Assignment: audit retries"), assistant("auditing"), user("later")];
    assert.deepEqual(getFirstDialogue(branch, whitelist), { firstUser: "Assignment: audit retries", firstAssistant: "auditing" });
    assert.deepEqual(getFirstDialogue(branch), { firstUser: "later", firstAssistant: undefined });
    assert.deepEqual(getInitialDialogue(branch.slice(0, 2), whitelist), [
      { role: "user", text: "Assignment: audit retries" },
      { role: "assistant", text: "auditing" },
    ]);
    assert.deepEqual(getInitialDialogue(branch.slice(0, 2)), []);
  });

  it("does not count textless custom messages as initial dialogue history", () => {
    for (const content of [undefined, "", [{ type: "image" }]]) {
      const ignored = alert(content);
      assert.deepEqual(getInitialDialogue([ignored, ignored, assistant("waiting")], whitelist), []);
      assert.deepEqual(getInitialDialogue([ignored, ignored, user("waiting")], whitelist), []);
      assert.deepEqual(getInitialDialogue([ignored, user("first"), ignored, assistant("reply")], whitelist), [
        { role: "user", text: "first" }, { role: "assistant", text: "reply" },
      ]);
    }
  });

  it("counts custom parts toward the initial-dialogue history check", () => {
    const branch = [user("first"), assistant("reply"), alert("Assignment: new task")];
    assert.deepEqual(getInitialDialogue(branch), [
      { role: "user", text: "first" },
      { role: "assistant", text: "reply" },
    ]);
    assert.deepEqual(getInitialDialogue(branch, whitelist), [
      { role: "user", text: "first" },
      { role: "assistant", text: "reply" },
      { role: "user", text: "Assignment: new task" },
    ]);
  });
});

describe("rename markers", () => {
  it("parses generated and manual rename markers defensively", () => {
    assert.deepEqual(parseRenameMarker({ name: "标题", source: "ai", timestamp: 1 }), {
      kind: "ai", name: "标题", source: "ai", timestamp: 1,
    });
    assert.deepEqual(parseRenameMarker({ name: "fallback", source: "fallback", timestamp: 2 }), {
      kind: "fallback", name: "fallback", source: "fallback", timestamp: 2,
    });
    assert.deepEqual(parseRenameMarker({ event: "user_rename", name: "Manual" }), {
      kind: "user_rename", name: "Manual", timestamp: 0,
    });
    assert.equal(parseRenameMarker({ source: "unknown", name: "x" }), undefined);
    assert.equal(parseRenameMarker(null), undefined);
  });
});
