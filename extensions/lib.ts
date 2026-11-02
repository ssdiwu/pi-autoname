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
  // Quoted JSON/YAML keys need their closing quote consumed before the colon.
  // Match the whole quoted value, including escaped quotes and whitespace.
  { re: /((["'])(?:api[_-]?key|token|secret|password|[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\2\s*:\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,}\]]+)/gi, replacement: '$1"[REDACTED]"' },
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
export function getNamingLanguageInstruction(parts: DialoguePart[], fallbackLocale?: string, explicitLanguage = "auto"): string {
  if (explicitLanguage !== "auto") {
    return `Write the label in ${localeLanguageName(explicitLanguage)} (locale: ${explicitLanguage}). This explicit language setting overrides user-message language detection and the Pi locale.`;
  }
  const language = detectDominantUserLanguage(parts);
  if (language === "Chinese") return "Write the label in Chinese, preserving the Simplified or Traditional script used by the user. This language is determined from user messages only.";
  if (language) return `Write the label in ${language}. This language is determined from user messages only.`;
  if (fallbackLocale?.trim()) return `No natural-language user text was detected. Use the language selected in the user's Pi locale: ${localeLanguageName(fallbackLocale)}.`;
  return "No natural-language user text was detected. Infer the label language from user messages only, never from assistant messages.";
}

export interface AutonameConfig {
  enabled?: boolean;
  /** Animate the TUI terminal title while the agent or naming model is working. */
  titleSpinner?: boolean;
  model?: string;
  fallbackModels?: string[];
  /** BCP 47 locale for AI labels; auto keeps user-message detection. */
  language?: string;
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
  /**
   * Which `custom_message` session entries (extension-injected messages that
   * participate in LLM context) are treated as user input for naming.
   * `false` (default) ignores them, `true` includes all of them, and a string
   * array whitelists entries by `customType`. Normalized to `false`, `true`,
   * or a non-empty array of trimmed strings.
   */
  includeCustomMessages?: boolean | string[];
}

export const DEFAULT_CONFIG: Required<AutonameConfig> = {
  enabled: true,
  titleSpinner: true,
  model: "",
  fallbackModels: [],
  language: "auto",
  cooldownMinutes: 10,
  debug: false,
  respectManualName: false,
  includeCustomMessages: false,
};

export const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type NamingThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Unknown colon suffixes remain part of the model ID. */
export function parseModelRef(modelName: string): { provider: string; id: string; thinking?: NamingThinkingLevel } | undefined {
  const value = modelName.trim();
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  const provider = value.slice(0, slash);
  const id = value.slice(slash + 1);
  const colon = id.lastIndexOf(":");
  const suffix = id.slice(colon + 1);
  if (colon > 0 && THINKING_LEVELS.some(level => level === suffix)) {
    return { provider, id: id.slice(0, colon), thinking: suffix as NamingThinkingLevel };
  }
  return { provider, id };
}

function normalizeLanguage(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().toLowerCase() === "auto") return "auto";
  try {
    return Intl.getCanonicalLocales(value.trim())[0] ?? "auto";
  } catch {
    return "auto";
  }
}

function normalizeIncludeCustomMessages(value: unknown): boolean | string[] {
  if (value === true) return true;
  if (!Array.isArray(value)) return false;
  const whitelist = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return whitelist.length > 0 ? whitelist : false;
}

export interface DialogueOptions {
  /** Returns true when a `custom_message` with this `customType` is naming input. */
  includeCustomType?: (customType: string) => boolean;
}

/** Builds the extraction options for a normalized `includeCustomMessages` value. */
export function getDialogueOptions(includeCustomMessages: AutonameConfig["includeCustomMessages"]): DialogueOptions {
  if (includeCustomMessages === true) return { includeCustomType: () => true };
  if (Array.isArray(includeCustomMessages) && includeCustomMessages.length > 0) {
    const whitelist = new Set(includeCustomMessages);
    return { includeCustomType: (customType) => whitelist.has(customType) };
  }
  return {};
}

export function normalizeConfig(input: unknown): AutonameConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_CONFIG };

  const raw = input as Record<string, unknown>;
  const cooldown =
    typeof raw.cooldownMinutes === "number" && Number.isFinite(raw.cooldownMinutes)
      ? Math.min(MAX_COOLDOWN_MINUTES, Math.max(MIN_COOLDOWN_MINUTES, raw.cooldownMinutes))
      : DEFAULT_CONFIG.cooldownMinutes;

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_CONFIG.enabled,
    titleSpinner: typeof raw.titleSpinner === "boolean" ? raw.titleSpinner : DEFAULT_CONFIG.titleSpinner,
    model: typeof raw.model === "string" ? raw.model.trim() : DEFAULT_CONFIG.model,
    language: normalizeLanguage(raw.language),
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
    includeCustomMessages: normalizeIncludeCustomMessages(raw.includeCustomMessages),
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
  }

  s = s.replace(/(?:吗|呢|吧|啊|呀|哦|嘛|的|了|着|过)[\s,，.。]*$/, "").trim();
  s = s.replace(/[。！？!?.…]+\s*$/, "").trim();

  return limitNameLength(s || text.replace(/\n/g, " ").trim());
}

/** Share the quality limit across AI extraction and local fallback. */
export function limitNameLength(text: string): string {
  if (text.length <= MAX_NAME_LENGTH) return text;
  let prefix = text.slice(0, MAX_NAME_LENGTH);
  // Do not cut an astral character between its UTF-16 surrogate halves.
  prefix = prefix.replace(/[\uD800-\uDBFF]$/, "");
  const space = prefix.lastIndexOf(" ");
  return (space > MAX_NAME_LENGTH / 2 ? prefix.slice(0, space) : prefix).trim();
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

/**
 * `custom_message` entries keep their content at the top level and are always
 * part of LLM context regardless of their TUI-only `display` flag.
 */
function isIncludedCustomMessage(entry: any, options: DialogueOptions): boolean {
  if (entry?.type !== "custom_message" || !options.includeCustomType) return false;
  return options.includeCustomType(typeof entry.customType === "string" ? entry.customType : "");
}

export function getFirstDialogue(branch: any[], options: DialogueOptions = {}) {
  let firstUser: string | undefined;
  let firstAssistant: string | undefined;

  for (const entry of branch) {
    if (!firstUser && isIncludedCustomMessage(entry, options)) {
      const text = blockText(entry.content);
      if (text) firstUser = text;
      continue;
    }

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

export function getRecentDialogue(branch: any[], maxMessages = 6, options: DialogueOptions = {}): DialoguePart[] {
  const items: DialoguePart[] = [];

  for (let index = branch.length - 1; index >= 0 && items.length < maxMessages; index -= 1) {
    const entry = branch[index];
    if (isIncludedCustomMessage(entry, options)) {
      const text = blockText(entry.content);
      if (text) items.push({ role: "user", text });
      continue;
    }
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
export function getInitialDialogue(branch: any[], options: DialogueOptions = {}): DialoguePart[] {
  const recent = getRecentDialogue(branch, 6, options);
  let messageCount = 0;
  for (let index = branch.length - 1; index >= 0 && messageCount <= 2; index -= 1) {
    const entry = branch[index];
    const role = entry?.message?.role;
    const hasCustomText = isIncludedCustomMessage(entry, options) && Boolean(blockText(entry.content));
    if (role === "user" || role === "assistant" || hasCustomText) messageCount += 1;
  }

  if (messageCount > 2) return recent;

  const { firstUser, firstAssistant } = getFirstDialogue(branch, options);
  if (!firstUser || !firstAssistant) return [];
  return [
    { role: "user", text: firstUser },
    { role: "assistant", text: firstAssistant },
  ];
}
