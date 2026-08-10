/**
 * pi-autoname pure utility functions.
 * Extracted for testability — no side effects, no fs, no network.
 */

/** A name this short was likely a failed AI response */
export const MIN_NAME_LENGTH = 3;

/** Max length for a session name — anything longer is likely a raw sentence */
export const MAX_NAME_LENGTH = 30;

/** Names matching this pattern are raw-slice fallbacks (bad) */
export const RAW_SLICE_RE =
  /^(?:我|你|他|她|它|请|帮|能|可|可以|能不能|请帮|感觉|突然|我想|我想知道|有没有|是不是|为什么|怎么|如何|What|Can|Could|Please|Help|I want|I need|Is there|Why|How)/;

/** Sentence-ending punctuation — a real session name should not contain these */
export const SENTENCE_END_RE = /[。！？!?.…]+\s*$/;

export const MIN_COOLDOWN_MINUTES = 1;
export const MAX_COOLDOWN_MINUTES = 24 * 60;

export const SENSITIVE_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi, replacement: "$1[REDACTED]" },
  { re: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*["']?[^"'\s]+/g, replacement: "$1=[REDACTED]" },
  { re: /\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[^"'\s,;]+/gi, replacement: "$1=[REDACTED]" },
];

export interface DialoguePart {
  role: "user" | "assistant";
  text: string;
}

export type NamingLanguage = "Chinese" | "English" | "Japanese" | "Korean";

function naturalLanguageText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?:^|\s)(?:~\/|\/)[^\s]+/g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:const|let|var|function|class|import|export|return)\b|[{};]|=>/.test(line))
    .join(" ");
}

function scriptCount(text: string, script: RegExp): number {
  return (text.match(script) ?? []).length;
}

/**
 * Determines the language from user-authored natural-language text only.
 * CJK scripts receive extra weight so paths and code identifiers do not
 * outweigh prose in a Chinese, Japanese, or Korean request.
 */
export function detectDominantUserLanguage(parts: DialoguePart[]): NamingLanguage | undefined {
  const scores: Record<NamingLanguage, number> = { Chinese: 0, English: 0, Japanese: 0, Korean: 0 };
  const firstSeen = new Map<NamingLanguage, number>();
  let seen = 0;

  const addScore = (language: NamingLanguage, score: number) => {
    if (score <= 0) return;
    if (!firstSeen.has(language)) firstSeen.set(language, seen);
    scores[language] += score;
  };

  for (const part of parts) {
    if (part.role !== "user") continue;
    const text = naturalLanguageText(part.text);
    const han = scriptCount(text, /\p{Script=Han}/gu);
    const kana = scriptCount(text, /[\u3040-\u30ff\u31f0-\u31ff]/gu);
    const hangul = scriptCount(text, /\p{Script=Hangul}/gu);
    const hasCjk = han > 0 || kana > 0 || hangul > 0;
    addScore(kana > 0 ? "Japanese" : "Chinese", (kana > 0 ? kana + han : han) * 2);
    addScore("Korean", hangul * 2);
    // A user message that already contains CJK is a CJK-language message: the
    // Latin characters inside it (paths, code identifiers, or system log/error
    // noise co-injected into the same message) must not dilute the user's CJK
    // intent. Only purely-Latin user messages contribute to English.
    if (!hasCjk) addScore("English", scriptCount(text, /\p{Script=Latin}/gu));
    seen += 1;
  }

  return (Object.keys(scores) as NamingLanguage[])
    .filter((language) => scores[language] > 0)
    .sort((left, right) => scores[right] - scores[left] || (firstSeen.get(left) ?? Infinity) - (firstSeen.get(right) ?? Infinity))[0];
}

function localeLanguageName(locale: string): string {
  const primary = locale.trim().replace(/_/g, "-").split("-")[0]?.toLowerCase();
  if (primary === "zh") return "Chinese";
  if (primary === "ja") return "Japanese";
  if (primary === "ko") return "Korean";
  if (primary === "en") return "English";
  return locale.trim();
}

/** Builds an explicit language requirement for the naming model. */
export function getNamingLanguageInstruction(parts: DialoguePart[], fallbackLocale?: string): string {
  const language = detectDominantUserLanguage(parts);
  if (language === "Chinese") return "Write the label in Chinese, preserving the Simplified or Traditional script used by the user. This language is determined from user messages only.";
  if (language) return `Write the label in ${language}. This language is determined from user messages only.`;
  if (fallbackLocale?.trim()) return `No natural-language user text was detected. Use the language selected in the user's Pi locale: ${localeLanguageName(fallbackLocale)}.`;
  return "No natural-language user text was detected. Infer the label language from user messages only, never from assistant messages.";
}

export interface AutonameConfig {
  enabled?: boolean;
  model?: string;
  fallbackModels?: string[];
  cooldownMinutes?: number;
  debug?: boolean;
  /**
   * When `false` (default), pi-autoname owns session naming:
   * automatic naming runs on first dialogue and periodically
   * (every `cooldownMinutes`), and may overwrite a name the
   * user set via `/name` or `/autoname`. The only escape hatch
   * is `respectManualName: true`, which preserves the legacy
   * behavior of treating a user-issued rename as sticky.
   *
   * Note: with the default behavior, Pi's built-in `/name`
   * command is largely redundant — prefer `/autoname` if you
   * want to force a re-name from the current conversation.
   */
  respectManualName?: boolean;
}

export const DEFAULT_CONFIG: Required<AutonameConfig> = {
  enabled: true,
  model: "",
  fallbackModels: [],
  cooldownMinutes: 10,
  debug: false,
  respectManualName: false,
};

export function normalizeConfig(input: unknown): AutonameConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_CONFIG };

  const raw = input as Record<string, unknown>;
  const cooldown =
    typeof raw.cooldownMinutes === "number" && Number.isFinite(raw.cooldownMinutes)
      ? Math.min(MAX_COOLDOWN_MINUTES, Math.max(MIN_COOLDOWN_MINUTES, raw.cooldownMinutes))
      : DEFAULT_CONFIG.cooldownMinutes;

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_CONFIG.enabled,
    model: typeof raw.model === "string" ? raw.model.trim() : DEFAULT_CONFIG.model,
    fallbackModels: Array.isArray(raw.fallbackModels)
      ? raw.fallbackModels
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : [...DEFAULT_CONFIG.fallbackModels],
    cooldownMinutes: cooldown,
    debug: typeof raw.debug === "boolean" ? raw.debug : DEFAULT_CONFIG.debug,
    respectManualName:
      typeof raw.respectManualName === "boolean" ? raw.respectManualName : DEFAULT_CONFIG.respectManualName,
  };
}

export function redactSensitiveText(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let output = text;

  for (const { re, replacement } of SENSITIVE_PATTERNS) {
    output = output.replace(re, (...args) => {
      redacted = true;
      return replacement.replace(/\$(\d+)/g, (_, index) => String(args[Number(index)] ?? ""));
    });
  }

  return { text: output, redacted };
}

export function isHighQualityName(name: string): boolean {
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) return false;
  if (RAW_SLICE_RE.test(name)) return false;
  if (SENTENCE_END_RE.test(name)) return false;
  if ((name.match(/[，,。！？!?]/g) || []).length > 1) return false;
  return /[\p{L}\p{N}]/u.test(name);
}

export function blockText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join(" ")
    .trim();
}

function trimNameLength(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  const cut = name.lastIndexOf(" ", MAX_NAME_LENGTH);
  return (cut >= 8 ? name.slice(0, cut) : name.slice(0, MAX_NAME_LENGTH)).trim();
}

export function extractCleanName(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const content = (response as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;

  const text = content
    .filter((block): block is { type: "text"; text: string } =>
      Boolean(block && typeof block === "object" && (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"))
    .map((block) => block.text)
    .join("")
    .trim();
  const thinkingLines = content
    .filter((block): block is { type: "thinking"; thinking: string } =>
      Boolean(block && typeof block === "object" && (block as { type?: unknown }).type === "thinking" &&
        typeof (block as { thinking?: unknown }).thinking === "string"))
    .map((block) => block.thinking)
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = (text || thinkingLines.at(-1) || "").trim();
  if (!candidate) return undefined;

  const firstLine = candidate.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? candidate;
  const cleaned = trimNameLength(firstLine
    .replace(/^['"`\u201c\u201d\u3001]+|['"`\u201c\u201d\u3001]+$/g, "")
    .replace(/[^\p{L}\p{N}\s\-_/.#+]/gu, "")
    .replace(/\s+/g, " ")
    .trim());

  return cleaned && isHighQualityName(cleaned) ? cleaned : undefined;
}

export function smartFallbackName(text: string): string {
  let s = text.slice(0, 200).replace(/\n/g, " ").trim();

  s = s
    .replace(
      /^(?:我(?:觉得|感觉|发现|想要|想知道|怀疑)?\s*|你(?:能|可以|帮)\s*(?:我\s*)?|请(?:你|帮我)?\s*|Can you\s*(?:please\s*)?(?:help me\s*)?|Could you\s*(?:please\s*)?(?:help me\s*)?|Please\s*(?:help me\s*)?|I\s*(?:think|feel|want|need|noticed)\s*(?:that\s*)?|Is it possible to\s*|I wonder if\s*|I'm wondering about\s*)/i,
      "",
    )
    .trim();

  const sentenceEnd = s.match(/[.!?。！？]/);
  if (sentenceEnd && sentenceEnd.index! < 60) {
    s = s.slice(0, sentenceEnd.index! + 1);
  } else if (s.length > 45) {
    const cut = s.lastIndexOf(" ", 45);
    s = cut > 10 ? s.slice(0, cut) : s.slice(0, 42);
  }

  s = s.replace(/(?:吗|呢|吧|啊|呀|哦|嘛|的|了|着|过)[\s,，.。]*$/, "").trim();
  s = s.replace(/[。！？!?.…]+\s*$/, "").trim();

  return trimNameLength(s || text.slice(0, MAX_NAME_LENGTH).replace(/\n/g, " ").trim());
}

/** A persisted pi-autoname state marker — one of three flavors. */
export type RenameMarker =
  | { kind: "ai"; name: string; source: "ai"; timestamp: number }
  | { kind: "fallback"; name: string; source: "fallback"; timestamp: number }
  | { kind: "user_rename"; name: string; timestamp: number };

/**
 * Parse a single `pi-autoname-state` entry's `data` payload into a typed
 * RenameMarker. Returns undefined when the payload doesn't match any
 * known shape (e.g. legacy entries from older versions, or corrupted
 * data). When parsing the timestamp, defaults to 0 if missing/invalid
 * so that the marker is still useful for relative ordering.
 */
export function parseRenameMarker(data: unknown): RenameMarker | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;

  // user_rename flavor — written when session_info_changed observes a /name
  // out-of-band change.
  if (obj.event === "user_rename" && typeof obj.name === "string") {
    return {
      kind: "user_rename",
      name: obj.name,
      timestamp: typeof obj.timestamp === "number" ? obj.timestamp : 0,
    };
  }

  // ai / fallback flavor — written after a successful naming pass.
  if (obj.source === "ai" && typeof obj.name === "string") {
    return {
      kind: "ai",
      name: obj.name,
      source: "ai",
      timestamp: typeof obj.timestamp === "number" ? obj.timestamp : 0,
    };
  }
  if (obj.source === "fallback" && typeof obj.name === "string") {
    return {
      kind: "fallback",
      name: obj.name,
      source: "fallback",
      timestamp: typeof obj.timestamp === "number" ? obj.timestamp : 0,
    };
  }

  return undefined;
}

export function getFirstDialogue(branch: any[]) {
  let firstUser: string | undefined;
  let firstAssistant: string | undefined;

  for (const entry of branch) {
    if (entry?.type === "message" && entry.message) {
      const role = entry.message.role;
      const text = blockText(entry.message.content);
      if (!text) continue;
      if (!firstUser && role === "user") firstUser = text;
      if (firstUser && !firstAssistant && role === "assistant") {
        firstAssistant = text;
        break;
      }
    }

    if (entry?.type === "compaction" && !firstUser) {
      const summary = blockText(entry.summary ?? entry.content);
      if (summary) firstUser = summary;
    }
  }

  return { firstUser, firstAssistant };
}

export function getRecentDialogue(branch: any[], maxMessages = 6): DialoguePart[] {
  const items: DialoguePart[] = [];

  for (let index = branch.length - 1; index >= 0 && items.length < maxMessages; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "message" || !entry.message) continue;

    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") continue;

    const text = blockText(entry.message.content);
    if (text) items.push({ role, text });
  }

  return items.reverse();
}

/**
 * Old sessions without an autoname marker should be named from their current
 * topic, while a new session keeps the first-dialogue behavior.
 */
export function getInitialDialogue(branch: any[]): DialoguePart[] {
  const recent = getRecentDialogue(branch);
  let messageCount = 0;
  for (let index = branch.length - 1; index >= 0 && messageCount <= 2; index -= 1) {
    const role = branch[index]?.message?.role;
    if (role === "user" || role === "assistant") messageCount += 1;
  }

  if (messageCount > 2) return recent;

  const { firstUser, firstAssistant } = getFirstDialogue(branch);
  if (!firstUser || !firstAssistant) return [];
  return [
    { role: "user", text: firstUser },
    { role: "assistant", text: firstAssistant },
  ];
}
