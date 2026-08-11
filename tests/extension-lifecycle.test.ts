import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const completeMock = vi.fn();
const getModelMock = vi.fn();

vi.mock("@earendil-works/pi-ai", () => ({
  complete: (...args: unknown[]) => completeMock(...args),
  getModel: (...args: unknown[]) => getModelMock(...args),
}));
vi.mock("@earendil-works/pi-ai/compat", () => ({
  complete: (...args: unknown[]) => completeMock(...args),
}));

// macOS's os.homedir() does not always honor process.env.HOME in tests, which would
// point CONFIG_PATH at the real user config. Mock the system boundary instead.
let currentHome = "";
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, homedir: () => currentHome };
});

type FakePi = ReturnType<typeof createFakePi>;

function createFakePi(branch: any[], initialSessionName?: string) {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
  const commands = new Map<string, any>();
  let sessionName = initialSessionName;

  return {
    on(event: string, handler: (event: any, ctx: any) => Promise<void>) {
      handlers.set(event, handler);
    },
    registerCommand(name: string, options: any) {
      commands.set(name, options);
    },
    appendEntry(customType: string, data: any) {
      branch.push({ type: "custom", customType, data });
    },
    setSessionName(name: string) {
      sessionName = name;
    },
    getSessionName() {
      return sessionName;
    },
    _getHandler(event: string) {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`missing handler: ${event}`);
      return async (event: any, ctx: any) => {
        await handler(event, ctx);
        // agent_settled intentionally starts naming in the background. Let
        // its already-resolved test promises drain without advancing timers.
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
      };
    },
    _getCommand(name: string) {
      return commands.get(name);
    },
    _getSessionName() {
      return sessionName;
    },
  };
}

function createContext(branch: any[], sessionFile?: string) {
  return {
    sessionManager: {
      getBranch: () => branch,
      getSessionFile: () => sessionFile,
    },
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "test-key", headers: {} })),
      find: vi.fn(() => null),
    },
    model: { provider: "test-provider", id: "test-model", api: "mock-api" },
    signal: new AbortController().signal,
    ui: { notify: vi.fn() },
  };
}

function message(role: "user" | "assistant", text: string) {
  return {
    type: "message",
    message: {
      role,
      content: role === "assistant" ? [{ type: "text", text }] : text,
    },
  };
}

async function loadExtensionModule(homeDir: string) {
  currentHome = homeDir;
  vi.resetModules();
  return import("../extensions/index.ts");
}

describe("extensions/index.ts lifecycle", () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "pi-autoname-ext-test-"));
    completeMock.mockReset();
    getModelMock.mockReset();
    vi.useRealTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it("root index.ts default export is the extension factory (entry smoke)", async () => {
    const mod = await loadExtensionModule(tempHome);
    expect(typeof mod.default).toBe("function");
  });

  it("detects naming language from user messages instead of shell locale", async () => {
    vi.stubEnv("LANG", "en_US.UTF-8");
    await fs.mkdir(path.join(tempHome, ".pi", "agent"), { recursive: true });
    await fs.writeFile(
      path.join(tempHome, ".pi", "agent", "pi-autoname.json"),
      JSON.stringify({ enabled: true }),
      "utf-8",
    );
    completeMock.mockResolvedValue({
      content: [{ type: "text", text: "Обновление Telegram в системе" }],
      stopReason: "stop",
      errorMessage: undefined,
    });

    const branch = [message("user", "обнови телеграм"), message("assistant", "обновляю")];
    const pi = createFakePi(branch);
    const ctx = createContext(branch);
    const { default: extension } = await loadExtensionModule(tempHome);

    extension(pi as any);
    await pi._getHandler("session_start")({}, ctx);
    await pi._getHandler("agent_settled")({}, ctx);

    const prompt = completeMock.mock.calls[0][1].messages[0].content[0].text;
    expect(prompt).toContain("Write the label in Russian");
    expect(prompt).not.toContain("Output in English");
  });

  it("does not surface session file diagnostics when debug is off", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-18T12:00:00.000Z");
    vi.setSystemTime(now);

    // Pre-create config with debug:false so loadConfig reads it instead of writing defaults.
    await fs.mkdir(path.join(tempHome, ".pi", "agent"), { recursive: true });
    await fs.writeFile(
      path.join(tempHome, ".pi", "agent", "pi-autoname.json"),
      JSON.stringify({ enabled: true, cooldownMinutes: 10, debug: false }),
      "utf-8",
    );
    const sessionFile = path.join(tempHome, "session.jsonl");
    await fs.writeFile(
      sessionFile,
      [JSON.stringify({ type: "session_info", id: "s1", parentId: null, timestamp: "2026-06-18T00:00:00.000Z", name: "现有标题" })].join("\n"),
      "utf-8",
    );

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const branch = [
        message("user", "继续"),
        message("assistant", "好的"),
        { type: "custom", customType: "pi-autoname-state", data: { name: "现有标题", source: "ai", timestamp: now.getTime() } },
      ];
      const pi = createFakePi(branch, "现有标题");
      const ctx = createContext(branch, sessionFile);
      const { default: extension } = await loadExtensionModule(tempHome);

      extension(pi as any);
      await pi._getHandler("session_start")({}, ctx);
    await pi._getHandler("agent_settled")({}, ctx);

      const calls = errSpy.mock.calls.map((c) => c.map(String).join(" "));
      expect(calls.some((s) => s.includes("sessionFileDiagnostics"))).toBe(false);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("surfaces session file diagnostics when debug is on", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-18T12:00:00.000Z");
    vi.setSystemTime(now);

    await fs.mkdir(path.join(tempHome, ".pi", "agent"), { recursive: true });
    await fs.writeFile(
      path.join(tempHome, ".pi", "agent", "pi-autoname.json"),
      JSON.stringify({ enabled: true, cooldownMinutes: 10, debug: true }),
      "utf-8",
    );
    const sessionFile = path.join(tempHome, "session.jsonl");
    await fs.writeFile(
      sessionFile,
      [JSON.stringify({ type: "session_info", id: "s1", parentId: null, timestamp: "2026-06-18T00:00:00.000Z", name: "现有标题" })].join("\n"),
      "utf-8",
    );

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const branch = [
        message("user", "继续"),
        message("assistant", "好的"),
        { type: "custom", customType: "pi-autoname-state", data: { name: "现有标题", source: "ai", timestamp: now.getTime() } },
      ];
      const pi = createFakePi(branch, "现有标题");
      const ctx = createContext(branch, sessionFile);
      const { default: extension } = await loadExtensionModule(tempHome);

      extension(pi as any);
      await pi._getHandler("session_start")({}, ctx);
    await pi._getHandler("agent_settled")({}, ctx);

      const calls = errSpy.mock.calls.map((c) => c.map(String).join(" "));
      expect(calls.some((s) => s.includes("sessionFileDiagnostics"))).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("hides config load errors when the config is invalid and debug is off", async () => {
    await fs.mkdir(path.join(tempHome, ".pi", "agent"), { recursive: true });
    await fs.writeFile(
      path.join(tempHome, ".pi", "agent", "pi-autoname.json"),
      "{ invalid json",
      "utf-8",
    );

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const branch = [message("user", "продолжи"), message("assistant", "хорошо")];
      const pi = createFakePi(branch);
      const ctx = createContext(branch);
      const { default: extension } = await loadExtensionModule(tempHome);

      extension(pi as any);
      await pi._getHandler("session_start")({}, ctx);

      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("reads latest session_info and pi-autoname marker from the current session file", async () => {
    const sessionFile = path.join(tempHome, "session.jsonl");
    await fs.writeFile(
      sessionFile,
      [
        JSON.stringify({ type: "session", version: 3, id: "abc", timestamp: "2026-06-18T00:00:00.000Z", cwd: "/tmp/demo" }),
        JSON.stringify({ type: "session_info", id: "a1", parentId: null, timestamp: "2026-06-18T00:01:00.000Z", name: "Old name" }),
        JSON.stringify({ type: "custom", id: "a2", parentId: "a1", timestamp: "2026-06-18T00:01:01.000Z", customType: "pi-autoname-state", data: { name: "Old name", source: "ai", timestamp: 1 } }),
        "{bad json",
        JSON.stringify({ type: "session_info", id: "a3", parentId: "a2", timestamp: "2026-06-18T00:02:00.000Z", name: "Manual name" }),
        JSON.stringify({ type: "custom", id: "a4", parentId: "a3", timestamp: "2026-06-18T00:02:01.000Z", customType: "pi-autoname-state", data: { event: "user_rename", name: "Manual name", timestamp: 2 } }),
      ].join("\n"),
      "utf-8",
    );

    const { readSessionFileDiagnostics } = await loadExtensionModule(tempHome);
    const diagnostics = readSessionFileDiagnostics(sessionFile);

    expect(diagnostics).toEqual({
      sessionFile,
      latestSessionName: "Manual name",
      latestRenameMarker: { kind: "user_rename", name: "Manual name", timestamp: 2 },
      parseErrors: 1,
    });
  });

  it("treats a pre-existing display name without matching marker as fresh and auto-renames after first dialogue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T08:22:19.500Z"));
    completeMock.mockResolvedValue({
      content: [{ type: "text", text: "语义化标题" }],
      stopReason: "stop",
      errorMessage: undefined,
    });

    const branch = [message("user", "帮我排查 session 命名问题"), message("assistant", "先读代码再判断")];
    const pi = createFakePi(branch, "pi-autoname");
    const ctx = createContext(branch);
    const { default: extension } = await loadExtensionModule(tempHome);

    extension(pi as any);
    await pi._getHandler("session_start")({}, ctx);
    await pi._getHandler("agent_settled")({}, ctx);

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(pi._getSessionName()).toBe("语义化标题");
    expect(branch.at(-1)).toMatchObject({
      type: "custom",
      customType: "pi-autoname-state",
      data: { name: "语义化标题", source: "ai" },
    });
  });

  it("uses local fallback when no naming model is available", async () => {
    const branch = [message("user", "Fix the database connection timeout"), message("assistant", "I will inspect the configuration")];
    const pi = createFakePi(branch);
    const ctx = createContext(branch);
    (ctx as any).model = null;
    const { default: extension } = await loadExtensionModule(tempHome);

    extension(pi as any);
    await pi._getHandler("session_start")({}, ctx);
    await pi._getHandler("agent_settled")({}, ctx);

    expect(completeMock).not.toHaveBeenCalled();
    expect(pi._getSessionName()).toBe("Fix the database connection");
    expect(branch.at(-1)).toMatchObject({
      type: "custom",
      customType: "pi-autoname-state",
      data: { name: "Fix the database connection", source: "fallback" },
    });
  });

  it("restores ai naming state and skips periodic rename before cooldown passes", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-18T09:00:00.000Z");
    vi.setSystemTime(now);

    const branch = [
      message("user", "先修复命名"),
      message("assistant", "好的"),
      { type: "custom", customType: "pi-autoname-state", data: { name: "已有标题", source: "ai", timestamp: now.getTime() } },
    ];
    const pi = createFakePi(branch, "已有标题");
    const ctx = createContext(branch);
    const { default: extension } = await loadExtensionModule(tempHome);

    extension(pi as any);
    await pi._getHandler("session_start")({}, ctx);
    vi.setSystemTime(new Date(now.getTime() + 59_000));
    await pi._getHandler("agent_settled")({}, ctx);

    expect(completeMock).not.toHaveBeenCalled();
    expect(pi._getSessionName()).toBe("已有标题");
  });

  it("records a user_rename marker when the session name changes out of band", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-18T10:00:00.000Z");
    vi.setSystemTime(now);

    const branch = [
      message("user", "继续当前任务"),
      message("assistant", "继续中"),
      { type: "custom", customType: "pi-autoname-state", data: { name: "AI 标题", source: "ai", timestamp: now.getTime() - 1_000 } },
    ];
    const pi = createFakePi(branch, "AI 标题");
    const ctx = createContext(branch);
    const { default: extension } = await loadExtensionModule(tempHome);

    extension(pi as any);
    await pi._getHandler("session_start")({}, ctx);
    pi.setSessionName("手工标题");
    vi.setSystemTime(new Date(now.getTime() + 5_000));
    await pi._getHandler("session_info_changed")({ name: "手工标题" }, ctx);
    await pi._getHandler("agent_settled")({}, ctx);

    expect(branch.at(-1)).toMatchObject({
      type: "custom",
      customType: "pi-autoname-state",
      data: { event: "user_rename", name: "手工标题", timestamp: now.getTime() + 5_000 },
    });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("respects manual names after cooldown when enabled", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-18T10:30:00.000Z");
    vi.setSystemTime(now);
    await fs.mkdir(path.join(tempHome, ".pi", "agent"), { recursive: true });
    await fs.writeFile(
      path.join(tempHome, ".pi", "agent", "pi-autoname.json"),
      JSON.stringify({ enabled: true, respectManualName: true, cooldownMinutes: 1 }),
      "utf-8",
    );
    completeMock.mockResolvedValue({
      content: [{ type: "text", text: "Новое автоматическое имя" }],
      stopReason: "stop",
      errorMessage: undefined,
    });

    const branch = [
      message("user", "продолжи задачу"),
      message("assistant", "продолжаю"),
      {
        type: "custom",
        customType: "pi-autoname-state",
        data: { name: "Автоматическое имя", source: "ai", timestamp: now.getTime() - 120_000 },
      },
    ];
    const pi = createFakePi(branch, "Автоматическое имя");
    const ctx = createContext(branch);
    const { default: extension } = await loadExtensionModule(tempHome);

    extension(pi as any);
    await pi._getHandler("session_start")({}, ctx);
    pi.setSessionName("Моё ручное имя");
    await pi._getHandler("session_info_changed")({ name: "Моё ручное имя" }, ctx);
    vi.setSystemTime(new Date(now.getTime() + 120_000));
    await pi._getHandler("agent_settled")({}, ctx);

    expect(completeMock).not.toHaveBeenCalled();
    expect(pi._getSessionName()).toBe("Моё ручное имя");
    expect(branch.at(-1)).toMatchObject({
      type: "custom",
      customType: "pi-autoname-state",
      data: { event: "user_rename", name: "Моё ручное имя" },
    });
  });

  it("renames from recent dialogue after cooldown passes", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-18T11:00:00.000Z");
    vi.setSystemTime(now);
    completeMock.mockResolvedValue({
      content: [{ type: "text", text: "新的会话标题" }],
      stopReason: "stop",
      errorMessage: undefined,
    });

    const branch = [
      message("user", "先做一版实现"),
      message("assistant", "已经完成首版"),
      message("user", "现在把测试补上"),
      message("assistant", "开始补 extension 生命周期测试"),
      { type: "custom", customType: "pi-autoname-state", data: { name: "旧标题", source: "ai", timestamp: now.getTime() - 11 * 60 * 1000 } },
    ];
    const pi = createFakePi(branch, "旧标题");
    const ctx = createContext(branch);
    const { default: extension } = await loadExtensionModule(tempHome);

    extension(pi as any);
    await pi._getHandler("session_start")({}, ctx);
      await pi._getHandler("agent_settled")({}, ctx);

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(pi._getSessionName()).toBe("新的会话标题");
    expect(branch.at(-1)).toMatchObject({
      type: "custom",
      customType: "pi-autoname-state",
      data: { name: "新的会话标题", source: "ai" },
    });
  });

  it("не восстанавливает тикет из существующего имени старой сессии", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-18T12:00:00.000Z");
    vi.setSystemTime(now);
    await fs.mkdir(path.join(tempHome, ".pi", "agent"), { recursive: true });
    await fs.writeFile(
      path.join(tempHome, ".pi", "agent", "pi-autoname.json"),
      JSON.stringify({
        enabled: true,
        cooldownMinutes: 10,
        maxNameLength: 80,
        ticketPattern: "\\b([A-Z]+-\\d+)\\b",
      }),
      "utf-8",
    );
    completeMock.mockResolvedValue({
      content: [{ type: "text", text: "DVR-12665 Проверка черновых комментариев" }],
      stopReason: "stop",
      errorMessage: undefined,
    });

    const branch = [
      message("user", "Уточни последний комментарий"),
      message("assistant", "Уточняю детали"),
      {
        type: "custom",
        customType: "pi-autoname-state",
        data: {
          name: "DVR-12665 Старое название",
          source: "ai",
          timestamp: now.getTime() - 11 * 60 * 1000,
        },
      },
    ];
    const pi = createFakePi(branch, "DVR-12665 Старое название");
    const ctx = createContext(branch);
    const { default: extension } = await loadExtensionModule(tempHome);

    extension(pi as any);
    await pi._getHandler("session_start")({}, ctx);
      await pi._getHandler("agent_settled")({}, ctx);

    expect(pi._getSessionName()).toBe("Проверка черновых комментариев");
    expect(branch.at(-1)).toMatchObject({
      type: "custom",
      customType: "pi-autoname-state",
      data: {
        name: "Проверка черновых комментариев",
        source: "ai",
      },
    });
    const lastEntry = branch.at(-1) as { type?: string; data?: unknown } | undefined;
    expect(lastEntry?.type).toBe("custom");
    expect(lastEntry?.data).not.toHaveProperty("ticketPrefix");
  });

  it("сохраняет единственный тикет из первого сообщения между переименованиями", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-18T13:00:00.000Z");
    vi.setSystemTime(now);
    await fs.mkdir(path.join(tempHome, ".pi", "agent"), { recursive: true });
    await fs.writeFile(
      path.join(tempHome, ".pi", "agent", "pi-autoname.json"),
      JSON.stringify({
        enabled: true,
        cooldownMinutes: 10,
        maxNameLength: 80,
        ticketPattern: "\\b([A-Z]+-\\d+)\\b",
      }),
      "utf-8",
    );
    completeMock
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Первичная проверка ревью" }],
        stopReason: "stop",
        errorMessage: undefined,
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Обновление черновых комментариев" }],
        stopReason: "stop",
        errorMessage: undefined,
      });

    const branch = [
      message("user", "DVR-12665 проверь ревью"),
      message("assistant", "Начинаю проверку"),
    ];
    const pi = createFakePi(branch);
    const ctx = createContext(branch);
    const { default: extension } = await loadExtensionModule(tempHome);

    extension(pi as any);
    await pi._getHandler("session_start")({}, ctx);
      await pi._getHandler("agent_settled")({}, ctx);
    expect(pi._getSessionName()).toBe("DVR-12665 Первичная проверка ревью");

    branch.push(
      message("user", "Уточни первый комментарий"),
      message("assistant", "Уточняю первый комментарий"),
      message("user", "Проверь второй комментарий"),
      message("assistant", "Проверяю второй комментарий"),
      message("user", "Теперь обнови черновик"),
      message("assistant", "Обновляю черновик без номера задачи"),
    );
    vi.setSystemTime(new Date(now.getTime() + 11 * 60 * 1000));
      await pi._getHandler("agent_settled")({}, ctx);

    expect(pi._getSessionName()).toBe("DVR-12665 Обновление черновых комментариев");
    expect(branch.at(-1)).toMatchObject({
      type: "custom",
      customType: "pi-autoname-state",
      data: {
        name: "DVR-12665 Обновление черновых комментариев",
        source: "ai",
        ticketPrefix: "DVR-12665",
      },
    });
  });
});
