import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG } from "../extensions/lib.ts";
import { TITLE_FRAME_MS } from "../extensions/title-spinner.ts";

let instance = 0;
async function setup(t: any, options: {
  user?: string;
  name?: string;
  mode?: "tui" | "rpc" | "json" | "print";
  config?: Record<string, unknown>;
  rawConfig?: string;
  diagnostics?: boolean;
  branch?: any[];
  complete?: (model: any, context: any, options: any) => Promise<any>;
} = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-autoname-test-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const configDir = join(home, ".pi", "agent");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "pi-autoname.json"), options.rawConfig ?? JSON.stringify({ ...DEFAULT_CONFIG, ...options.config }));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  let extension: any;
  try {
    extension = (await import(`../extensions/index.ts?test=${++instance}`)).default;
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
  const handlers = new Map<string, any>();
  const commands = new Map<string, any>();
  const markers: any[] = [];
  const notifications: any[] = [];
  const titles: string[] = [];
  const calls: any[] = [];
  let name = options.name;
  const branch: any[] = options.branch ?? [
    { type: "message", message: { role: "user", content: options.user ?? "修复数据库连接" } },
    { type: "message", message: { role: "assistant", content: "开始检查" } },
  ];
  const sessionFile = options.diagnostics ? join(home, "private-session-path.jsonl") : undefined;
  if (sessionFile) writeFileSync(sessionFile, [
    JSON.stringify({ type: "session_info", name: "private-diagnostic-title" }),
    JSON.stringify({ type: "custom", customType: "pi-autoname-state", data: { name: "private-marker-title", source: "ai", timestamp: 1 } }),
    "malformed-private-diagnostic-content",
  ].join("\n"));
  const model = { provider: "fixture", id: "keyless" };
  const ctx = {
    cwd: "/projects/app",
    mode: options.mode ?? "print",
    hasUI: options.mode === "tui" || options.mode === "rpc",
    model,
    modelRegistry: {
      find: (provider: string, id: string) => ({ provider, id }),
      // No getApiKeyAndHeaders: authentication belongs to the host runtime.
      streamSimple: (model: any, context: any, requestOptions: any) => ({ result: async () => {
        calls.push({ model, context, options: requestOptions });
        return options.complete ? options.complete(model, context, requestOptions) : { content: [{ type: "text", text: "数据库连接修复" }] };
      } }),
    },
    sessionManager: { getBranch: () => branch, getSessionFile: () => sessionFile },
    ui: { notify: (...args: any[]) => notifications.push(args), setTitle: (title: string) => titles.push(title) },
  };
  const pi = {
    on: (event: string, handler: any) => handlers.set(event, handler),
    registerCommand: (command: string, definition: any) => commands.set(command, definition),
    events: { emit: () => {} },
    getSessionName: () => name,
    setSessionName: (next: string) => {
      name = next;
      handlers.get("session_info_changed")?.({ name: next }, ctx);
    },
    appendEntry: (customType: string, data: any) => {
      markers.push(data);
      branch.push({ type: "custom", customType, data });
    },
  };
  extension(pi);
  await handlers.get("session_start")({}, ctx);
  t.after(() => handlers.get("session_shutdown")?.({}, ctx));
  return {
    calls, markers, notifications, titles, ctx,
    emit: (type: string, event: any = {}) => handlers.get(type)?.(event, ctx),
    get name() { return name; },
    externalName: async (next: string) => { name = next; await handlers.get("session_info_changed")({ name: next }, ctx); },
    manual: () => commands.get("autoname").handler("", ctx),
    settled: async () => {
      handlers.get("agent_settled")({}, ctx);
      for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
    },
    reload: () => handlers.get("session_start")({}, ctx),
    shutdown: () => handlers.get("session_shutdown")({}, ctx),
  };
}

describe("terminal title lifecycle integration", () => {
  it("stays busy across tools, low-level agent ends and retries until settlement", async t => {
    const test = await setup(t, { mode: "tui", name: "Manual title", config: { enabled: false } });
    t.mock.timers.enable({ apis: ["setInterval"] });
    await test.emit("before_agent_start");
    assert.equal(test.titles.at(-1), "π - ⠋ - Manual title");
    await test.emit("agent_start");
    await test.emit("tool_execution_start");
    await test.emit("agent_end");
    t.mock.timers.tick(TITLE_FRAME_MS);
    assert.equal(test.titles.at(-1), "π - ⠙ - Manual title");
    await test.emit("agent_start");
    assert.equal(test.titles.at(-1), "π - ⠙ - Manual title");
    await test.settled();
    assert.equal(test.titles.at(-1), "π - Manual title");
    assert.equal(test.name, "Manual title");
    assert.deepEqual(test.markers, []);
    assert.deepEqual(test.calls, []);
    const count = test.titles.length;
    t.mock.timers.tick(TITLE_FRAME_MS * 10);
    assert.equal(test.titles.length, count);
  });

  it("updates manual names immediately without persisting spinner frames", async t => {
    const test = await setup(t, { mode: "tui", config: { respectManualName: true } });
    await test.emit("agent_start");
    await test.externalName("Protected title");
    assert.equal(test.titles.at(-1), "π - ⠋ - Protected title");
    await test.settled();
    assert.equal(test.titles.at(-1), "π - Protected title");
    assert.equal(test.name, "Protected title");
    assert.equal(test.markers.length, 1);
    assert.equal(test.markers[0].name, "Protected title");
    assert.deepEqual(test.calls, []);
  });

  it("animates background and manual naming without blocking settlement", async t => {
    let resolve: any;
    const test = await setup(t, { mode: "tui", complete: () => new Promise(done => { resolve = done; }) });
    await test.emit("agent_start");
    await test.settled();
    assert.equal(test.calls.length, 1);
    assert.equal(test.titles.at(-1), "π - ⠋ - app");
    resolve({ content: [{ type: "text", text: "Background name" }] });
    for (let i = 0; i < 10; i++) await new Promise(done => setImmediate(done));
    assert.equal(test.titles.at(-1), "π - Background name");
    const pending = test.manual();
    assert.equal(test.titles.at(-1), "π - ⠋ - Background name");
    resolve({ content: [{ type: "text", text: "Manual refresh" }] });
    await pending;
    assert.equal(test.titles.at(-1), "π - Manual refresh");
  });

  it("does not let a late naming completion stop the next session's spinner", async t => {
    let resolve: any;
    const test = await setup(t, { mode: "tui", complete: () => new Promise(done => { resolve = done; }) });
    const pending = test.manual();
    await test.shutdown();
    assert.equal(test.calls[0].options.signal.aborted, true);
    assert.equal(test.titles.at(-1), "π - app");
    await test.reload();
    await test.emit("agent_start");
    const count = test.titles.length;
    resolve({ content: [{ type: "text", text: "Stale name" }] });
    await pending;
    assert.equal(test.titles.length, count);
    assert.equal(test.titles.at(-1), "π - ⠋ - app");
    assert.equal(test.name, undefined);
  });

  it("clears the naming marker on model failure and safe local fallback", async t => {
    const test = await setup(t, { mode: "tui", complete: async () => { throw new Error("fixture failure"); } });
    await test.manual();
    assert.equal(test.titles.at(-1), "π - 修复数据库连接");
    assert.ok(test.titles.some(title => title.includes("⠋")));
  });

  it("never sets titles in RPC, JSON or print mode", async t => {
    for (const mode of ["rpc", "json", "print"] as const) {
      const test = await setup(t, { mode });
      await test.emit("before_agent_start");
      await test.emit("agent_start");
      await test.settled();
      await test.manual();
      await test.shutdown();
      assert.deepEqual(test.titles, []);
      assert.equal(test.name, "数据库连接修复");
    }
  });

  it("can disable title ownership without disabling semantic naming", async t => {
    const test = await setup(t, { mode: "tui", config: { titleSpinner: false } });
    await test.emit("agent_start");
    await test.settled();
    await test.manual();
    await test.shutdown();
    assert.deepEqual(test.titles, []);
    assert.equal(test.name, "数据库连接修复");
  });
});

describe("extension naming integration", () => {
  it("treats a not-yet-created session file as normal during start and reload", async t => {
    const logs: string[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => logs.push(JSON.stringify(args)));
    const test = await setup(t, { config: { debug: true } });
    test.ctx.sessionManager.getSessionFile = () => join(tmpdir(), "pi-autoname-not-created", "session.jsonl");
    await test.reload();
    assert.doesNotMatch(logs.join("\n"), /session diagnostics failed/);
    await test.settled();
    assert.equal(test.name, "数据库连接修复");
  });

  it("extracts concise labels from multiline text and reasoning-only replies", async t => {
    for (const content of [
      [{ type: "text", text: "Session naming quality\nThis explanation should not become part of the name." }],
      [{ type: "thinking", thinking: "Consider the task and choose a concise label.\nDatabase connection retry" }],
    ]) {
      const test = await setup(t, { complete: async () => ({ content }) });
      await test.manual();
      assert.equal(test.name, content[0].type === "text" ? "Session naming quality" : "Database connection retry");
      assert.equal(test.markers[0].source, "ai");
    }
  });

  it("keeps long clean local fallbacks inside the shared quality limit", async t => {
    const test = await setup(t, {
      user: "Refactor database connection retry behavior and improve timeout handling",
      complete: async () => { throw new Error("fixture failure"); },
    });
    await test.manual();
    assert.equal(test.name, "Refactor database connection");
    assert.equal(test.markers[0].source, "fallback");
  });

  it("routes configured thinking suffixes through the host without discarding model colons", async t => {
    const test = await setup(t, {
      config: { model: "fixture/primary:low", fallbackModels: ["fixture/backup:high"] },
      complete: async model => {
        if (model.id === "primary") throw new Error("fixture failure");
        return { content: [{ type: "text", text: "回退模型命名" }] };
      },
    });
    await test.manual();
    assert.deepEqual(test.calls.map(call => [call.model.id, call.options.reasoning]), [["primary", "low"], ["backup", "high"]]);
    const colon = await setup(t, { config: { model: "fixture/model:custom" } });
    await colon.manual();
    assert.equal(colon.calls[0].model.id, "model:custom");
    assert.equal(colon.calls[0].options.reasoning, undefined);
  });

  it("deduplicates identical model efforts while preserving distinct configured fallbacks", async t => {
    const test = await setup(t, {
      config: { model: "fixture/shared:low", fallbackModels: ["fixture/shared:low", "fixture/shared:high"] },
      complete: async (_model, _context, options) => {
        if (options.reasoning === "low") throw new Error("fixture failure");
        return { content: [{ type: "text", text: "回退级别命名" }] };
      },
    });
    await test.manual();
    assert.deepEqual(test.calls.map(call => [call.model.id, call.options.reasoning]), [["shared", "low"], ["shared", "high"]]);
  });

  it("lets explicit naming language override English user text and keeps auto as default", async t => {
    const test = await setup(t, { user: "Refactor database connections", config: { language: "zh-CN" } });
    await test.manual();
    const prompt = test.calls[0].context.messages[0].content[0].text;
    assert.match(prompt, /zh-CN/);
    assert.match(prompt, /explicit/i);
    const automatic = await setup(t, { user: "Refactor database connections" });
    await automatic.manual();
    assert.match(automatic.calls[0].context.messages[0].content[0].text, /English/);
  });

  it("keeps debug diagnostics useful without logging names, paths, content or provider errors", async t => {
    const logs: string[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => logs.push(JSON.stringify(args)));
    let resolveFirst: any;
    let attempts = 0;
    const test = await setup(t, {
      name: "private-existing-title", user: "private-user-content",
      config: { debug: true }, diagnostics: true,
      complete: async () => {
        attempts++;
        if (attempts === 1) return new Promise(resolve => { resolveFirst = resolve; });
        if (attempts === 4) throw new Error("private-provider-error private-existing-title");
        return { content: [{ type: "text", text: "private-generated-title" }] };
      },
    });
    const first = test.manual();
    await test.manual();
    resolveFirst({ content: [{ type: "text", text: "private-stale-title" }] });
    await first;
    await test.manual(); // unchanged title
    await test.externalName("private-manual-title");
    await test.manual(); // provider failure
    const diagnosticFile = test.ctx.sessionManager.getSessionFile();
    test.ctx.sessionManager.getSessionFile = () => dirname(diagnosticFile); // EISDIR remains a real IO error.
    await test.reload();
    test.ctx.sessionManager.getBranch = () => { throw new Error("private-controller-error"); };
    await test.manual();
    const output = logs.join("\n");
    assert.doesNotMatch(output, /private-|malformed-/);
    assert.match(output, /session diagnostics/);
    assert.match(output, /parseErrors.*1/);
    assert.match(output, /hasSessionName.*true/);
    assert.match(output, /markerKind.*ai/);
    assert.match(output, /skip stale naming result/);
    assert.match(output, /session name updated/);
    assert.match(output, /session name already current/);
    assert.match(output, /manual session name observed/);
    assert.match(output, /model.*failed/);
    assert.match(output, /session diagnostics failed/);
    assert.match(output, /readable.*false/);
    assert.match(output, /naming request failed/);
  });

  it("keeps debug output disabled by default on success and failure", async t => {
    const logs: unknown[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => logs.push(args));
    let fail = false;
    const test = await setup(t, { complete: async () => {
      if (fail) throw new Error("private-provider-error");
      return { content: [{ type: "text", text: "private-generated-title" }] };
    } });
    await test.manual();
    fail = true;
    await test.manual();
    assert.deepEqual(logs, []);
  });

  it("does not log malformed configuration contents on load failure", async t => {
    const logs: string[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => logs.push(JSON.stringify(args)));
    await setup(t, { rawConfig: 'private-config-secret' });
    assert.match(logs.join("\n"), /failed to load config/);
    assert.doesNotMatch(logs.join("\n"), /private-|pi-autoname-test-/);
  });

  it("redacts hidden custom messages and never uses their detected secrets as fallback titles", async t => {
    for (const fail of [false, true]) {
      const branch = [
        { type: "custom_message", customType: "worker", display: false, content: '{"password":"custom-secret-fixture"}' },
        { type: "message", message: { role: "assistant", content: "开始检查" } },
      ];
      const test = await setup(t, {
        branch, config: { includeCustomMessages: ["worker"] },
        complete: async () => {
          if (fail) throw new Error("fixture failure");
          return { content: [{ type: "text", text: "配置安全检查" }] };
        },
      });
      await test.settled();
      assert.equal(test.calls.length, 1);
      const prompt = test.calls[0].context.messages[0].content[0].text;
      assert.match(prompt, /REDACTED/);
      assert.doesNotMatch(prompt, /custom-secret-fixture/);
      assert.equal(test.name, fail ? undefined : "配置安全检查");
      if (fail) assert.deepEqual(test.markers, []);
    }
  });

  it("waits for textual user input when custom messages only contain images", async t => {
    const image = { type: "custom_message", customType: "worker", display: false, content: [{ type: "image", data: "fixture", mimeType: "image/png" }] };
    const branch = [image, image, { type: "message", message: { role: "assistant", content: "waiting" } }];
    const test = await setup(t, { branch, config: { includeCustomMessages: ["worker"] } });
    await test.settled();
    assert.equal(test.calls.length, 0);
    assert.equal(test.name, undefined);
    assert.deepEqual(test.markers, []);
    branch.push({ type: "message", message: { role: "user", content: "修复数据库连接" } });
    await test.settled();
    assert.equal(test.calls.length, 0, "a new textual user turn still needs its first assistant response");
    branch.push({ type: "message", message: { role: "assistant", content: "开始检查" } });
    await test.settled();
    assert.equal(test.calls.length, 1);
    assert.equal(test.name, "数据库连接修复");
  });

  it("automatically names through the runtime without requiring an API key", async t => {
    const test = await setup(t);
    await test.settled();
    assert.equal(test.name, "数据库连接修复");
    assert.equal(test.calls.length, 1);
    assert.equal(test.calls[0].options.maxTokens, 64);
    assert.ok(test.calls[0].options.signal instanceof AbortSignal);
    assert.equal(test.markers[0].source, "ai");
    await test.reload();
    await test.settled();
    assert.equal(test.calls.length, 1, "reload must restore the cooldown marker");
  });

  it("redacts JSON user content and the current name in the final model request", async t => {
    const test = await setup(t, {
      user: '{"password":"demo123","API_KEY":"fixture-key-value"}',
      name: '{"token":"fixture-title-token"}',
    });
    await test.manual();
    const prompt = test.calls[0].context.messages[0].content[0].text;
    assert.doesNotMatch(prompt, /demo123|fixture-key-value|fixture-title-token/);
    assert.match(prompt, /REDACTED/);
    assert.equal(test.name, "数据库连接修复");
  });

  it("does not persist a JSON secret as a fallback name after model failure", async t => {
    const test = await setup(t, { user: '{"password":"demo123"}', complete: async () => { throw new Error("fixture failure"); } });
    await test.manual();
    assert.equal(test.name, undefined);
    assert.deepEqual(test.markers, []);
    assert.equal(test.notifications[0][1], "warning");
  });

  it("tries configured fallbacks through the same runtime", async t => {
    const test = await setup(t, {
      config: { model: "fixture/primary", fallbackModels: ["fixture/backup"] },
      complete: async model => {
        if (model.id === "primary") throw new Error("fixture authentication failure");
        return { content: [{ type: "text", text: "回退模型命名" }] };
      },
    });
    await test.manual();
    assert.deepEqual(test.calls.map(call => call.model.id), ["primary", "backup"]);
    assert.equal(test.name, "回退模型命名");
  });

  it("preserves clean local fallback naming when every model fails", async t => {
    const test = await setup(t, { complete: async () => { throw new Error("fixture failure"); } });
    await test.manual();
    assert.equal(test.name, "修复数据库连接");
    assert.equal(test.markers[0].source, "fallback");
  });

  it("bounds pending runtime work to 12-second attempts and a shared 30-second budget", async t => {
    const test = await setup(t, {
      config: { model: "fixture/primary", fallbackModels: ["fixture/backup"] },
      complete: async (_model, _context, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      }),
    });
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
    const pending = test.manual();
    assert.equal(test.calls.length, 1);
    t.mock.timers.tick(12_000);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(test.calls.length, 2);
    t.mock.timers.tick(12_000);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(test.calls.length, 3);
    t.mock.timers.tick(6_000);
    await pending;
    assert.equal(Date.now(), 31_000);
    assert.ok(test.calls.every(call => call.options.signal.aborted));
    assert.equal(test.name, "修复数据库连接");
    assert.equal(test.markers[0].source, "fallback");
  });

  it("cancels the runtime request on shutdown and rejects its late result", async t => {
    let resolve: any;
    const test = await setup(t, { complete: () => new Promise(done => { resolve = done; }) });
    const pending = test.manual();
    assert.equal(test.calls.length, 1);
    await test.shutdown();
    assert.equal(test.calls[0].options.signal.aborted, true);
    resolve({ content: [{ type: "text", text: "过期模型标题" }] });
    await pending;
    assert.equal(test.name, undefined);
    assert.deepEqual(test.markers, []);
  });
});
