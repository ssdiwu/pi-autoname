import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_CONFIG,
  MAX_COOLDOWN_MINUTES,
  MAX_NAME_LENGTH,
  MIN_COOLDOWN_MINUTES,
  blockText,
  compileTicketPattern,
  detectDominantUserLanguage,
  extractTicketPrefix,
  limitNameLength,
  withoutTicketPrefix,
  withTicketPrefix,
  getFirstDialogue,
  getInitialDialogue,
  getNamingLanguageInstruction,
  getRecentDialogue,
  isHighQualityName,
  normalizeConfig,
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
    assert.deepEqual(normalizeConfig({ locale: " ru_RU ", maxNameLength: 80, promptExtra: " longer ", ticketPattern: " \\b([A-Z]+-\\d+)\\b " }), {
      ...DEFAULT_CONFIG,
      locale: "ru_RU",
      maxNameLength: 80,
      promptExtra: "longer",
      ticketPattern: "\\b([A-Z]+-\\d+)\\b",
    });
  });

  it("redacts common secrets without changing clean text", () => {
    assert.deepEqual(redactSensitiveText("hello"), { text: "hello", redacted: false });
    const result = redactSensitiveText("API_KEY=secret and Bearer abcdefghijklmnopqrstuvwxyz");
    assert.equal(result.redacted, true);
    assert.match(result.text, /API_KEY=\[REDACTED\]/);
    assert.match(result.text, /Bearer \[REDACTED\]/);
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

describe("ticket prefixes and name limits", () => {
  it("extracts one unique ticket from user context only", () => {
    assert.equal(extractTicketPrefix([
      { role: "user", text: "Проверь ABC-123" },
      { role: "assistant", text: "Также вижу XYZ-9" },
    ], "\\b([A-Z]+-\\d+)\\b"), "ABC-123");
    assert.equal(extractTicketPrefix([{ role: "user", text: "ABC-123 и XYZ-9" }], "\\b([A-Z]+-\\d+)\\b"), undefined);
    assert.equal(extractTicketPrefix([{ role: "user", text: "ABC-123 /browse/ABC-123" }], "\\b([A-Z]+-\\d+)\\b"), "ABC-123");
    assert.equal(compileTicketPattern("[") , undefined);
  });

  it("removes an untrusted model ticket and preserves a trusted one", () => {
    assert.equal(withoutTicketPrefix("XYZ-9 Проверка", "\\b([A-Z]+-\\d+)\\b"), "Проверка");
    assert.equal(withTicketPrefix("ABC-123 Проверка", "ABC-123"), "ABC-123 Проверка");
  });

  it("limits the complete saved name including its ticket prefix", () => {
    assert.equal(limitNameLength(withTicketPrefix("fix auth", "ABC-123"), 10), "ABC-123 fi");
    assert.equal(limitNameLength(withTicketPrefix("fix auth", "ABC-123"), 10).length, 10);
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
    assert.ok(smartFallbackName("A".repeat(200)).length <= 50);
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

  it("uses configured locale before detected user language", () => {
    assert.match(
      getNamingLanguageInstruction(
        [{ role: "user", text: "Переименуй эту сессию" }],
        "en_US.UTF-8",
        "ru_RU.UTF-8",
      ),
      /configured locale: ru_RU/i,
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

describe("rename markers", () => {
  it("parses generated and manual rename markers defensively", () => {
    assert.deepEqual(parseRenameMarker({ name: "标题", source: "ai", timestamp: 1 }), {
      kind: "ai", name: "标题", source: "ai", timestamp: 1,
    });
    assert.deepEqual(parseRenameMarker({ name: "fallback", source: "fallback", timestamp: 2 }), {
      kind: "fallback", name: "fallback", source: "fallback", timestamp: 2,
    });
    assert.deepEqual(parseRenameMarker({ name: "ABC-123 title", source: "ai", ticketPrefix: "ABC-123", timestamp: 2 }), {
      kind: "ai", name: "ABC-123 title", source: "ai", ticketPrefix: "ABC-123", timestamp: 2,
    });
    assert.deepEqual(parseRenameMarker({ event: "user_rename", name: "Manual" }), {
      kind: "user_rename", name: "Manual", timestamp: 0,
    });
    assert.equal(parseRenameMarker({ source: "unknown", name: "x" }), undefined);
    assert.equal(parseRenameMarker(null), undefined);
  });
});
