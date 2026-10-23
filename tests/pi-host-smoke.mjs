// Optional offline smoke test against an installed Pi host; no user config or models are used.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.env.PI_HOST_ROOT) throw new Error("Set PI_HOST_ROOT to the installed @earendil-works/pi-coding-agent directory");
const host = resolve(process.env.PI_HOST_ROOT);
const root = fileURLToPath(new URL("../", import.meta.url));
const home = mkdtempSync(join(tmpdir(), "pi-autoname-host-"));
const oldHome = process.env.HOME;
process.env.HOME = home;
process.env.JITI_FS_CACHE = "false";
const load = path => import(pathToFileURL(join(host, path)).href);
// npm can hoist the host's peers beside it, rather than inside its node_modules.
const hostRequire = createRequire(join(host, "package.json"));
const aiDist = hostRequire.resolve.paths("@earendil-works/pi-ai")
  .map(path => join(path, "@earendil-works/pi-ai/dist"))
  .find(path => existsSync(join(path, "providers/faux.js")));
if (!aiDist) throw new Error("Cannot locate the host's pi-ai package");
const loadAI = path => import(pathToFileURL(join(aiDist, path)).href);
let runner;
try {
  const { ModelRuntime } = await load("dist/core/model-runtime.js");
  const { ModelRegistry } = await load("dist/core/model-registry.js");
  const { SessionManager } = await load("dist/core/session-manager.js");
  const { ExtensionRunner } = await load("dist/core/extensions/runner.js");
  const { loadExtensions } = await load("dist/core/extensions/loader.js");
  const { InMemoryCredentialStore } = await loadAI("auth/credential-store.js");
  const { fauxProvider, fauxAssistantMessage } = await loadAI("providers/faux.js");
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ provider: "autoname-offline-fixture", tokensPerSecond: Infinity });
  runtime.registerNativeProvider(faux.provider);
  const registry = new ModelRegistry(runtime);
  const model = faux.getModel();
  const requests = [];
  const streamSimple = registry.streamSimple.bind(registry);
  registry.streamSimple = (selected, context, options) => {
    requests.push({ selected, context, options });
    return streamSimple(selected, context, options);
  };
  const configDir = join(home, ".pi", "agent");
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "pi-autoname.json");
  let configClock = Date.now();
  const writeConfig = config => {
    writeFileSync(configPath, JSON.stringify(config));
    configClock += 1000;
    utimesSync(configPath, configClock / 1000, configClock / 1000);
  };
  let selectedModel = model;
  const auth = await registry.getApiKeyAndHeaders(model);
  assert.equal(auth.ok, true);
  assert.equal(auth.apiKey, undefined);
  const session = SessionManager.inMemory(root);
  const user = content => session.appendMessage({ role: "user", content, timestamp: Date.now() });
  const assistant = content => session.appendMessage(fauxAssistantMessage(content));
  user("修复数据库连接");
  assistant("开始检查");
  const errors = [];
  const titles = [];
  const start = async (mode = "tui") => {
    const loaded = await loadExtensions([join(root, "index.ts")], root);
    assert.deepEqual(loaded.errors, []);
    const current = new ExtensionRunner(loaded.extensions, loaded.runtime, root, session, registry);
    current.onError(error => errors.push(error));
    current.setUIContext({ notify() {}, setTitle: title => titles.push(title) }, mode);
    current.bindCore({
      appendEntry: (type, data) => session.appendCustomEntry(type, data),
      getSessionName: () => session.getSessionName(),
      setSessionName: name => {
        session.appendSessionInfo(name);
        void current.emit({ type: "session_info_changed", name });
      },
    }, {
      getModel: () => selectedModel, getScopedModels: () => [], isIdle: () => true,
      isProjectTrusted: () => true, getSignal: () => undefined,
      hasPendingMessages: () => false, getSystemPrompt: () => "",
    });
    await current.emit({ type: "session_start" });
    return current;
  };
  runner = await start();
  faux.setResponses([fauxAssistantMessage("数据库连接修复")]);
  await runner.emit({ type: "agent_settled", messages: [] });
  for (let i = 0; i < 100 && !session.getSessionName(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(session.getSessionName(), "数据库连接修复");
  assert.equal(faux.state.callCount, 1);
  await runner.emit({ type: "session_shutdown" });
  runner = await start();
  await runner.emit({ type: "agent_settled", messages: [] });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(faux.state.callCount, 1, "reloaded marker must preserve cooldown");
  user('{"password":"fixture-private-value"}');
  faux.setResponses([(context) => {
    assert.ok(!JSON.stringify(context).includes("fixture-private-value"));
    assert.ok(JSON.stringify(context).includes("REDACTED"));
    return fauxAssistantMessage("配置安全检查");
  }]);
  await runner.getCommand("autoname").handler("", runner.createCommandContext());
  assert.equal(session.getSessionName(), "配置安全检查");
  user("连接故障诊断");
  faux.setResponses([() => { throw new Error("offline fixture model failure"); }]);
  await runner.getCommand("autoname").handler("", runner.createCommandContext());
  assert.equal(session.getSessionName(), "连接故障诊断");
  user('{"password":"demo123"}');
  // Isolate the sensitive fallback case from earlier clean user turns in the six-part window.
  for (let i = 0; i < 5; i++) assistant("检查中");
  faux.setResponses([() => { throw new Error("offline fixture model failure"); }]);
  await runner.getCommand("autoname").handler("", runner.createCommandContext());
  assert.equal(session.getSessionName(), "连接故障诊断");
  writeConfig({ model: `${model.provider}/${model.id}:low`, language: "zh-CN" });
  user("Check model thinking and explicit naming language");
  faux.setResponses([fauxAssistantMessage("命名配置验证\nAdditional explanation must be ignored")]);
  await runner.getCommand("autoname").handler("", runner.createCommandContext());
  assert.equal(session.getSessionName(), "命名配置验证");
  assert.equal(requests.at(-1).options.reasoning, "low");
  assert.equal(requests.at(-1).selected.id, model.id);
  assert.match(requests.at(-1).context.messages[0].content[0].text, /zh-CN/);
  faux.setResponses([fauxAssistantMessage([{ type: "thinking", thinking: "Consider a concise title.\nRuntime naming verification" }])]);
  await runner.getCommand("autoname").handler("", runner.createCommandContext());
  assert.equal(session.getSessionName(), "Runtime naming verification");
  writeConfig({});
  user("Refactor database connection retry behavior and improve timeout handling");
  faux.setResponses([() => { throw new Error("offline fixture model failure"); }]);
  await runner.getCommand("autoname").handler("", runner.createCommandContext());
  assert.equal(session.getSessionName(), "Refactor database connection");
  let routes = 0;
  runtime.registerVirtualModel({
    provider: "autoname-router-fixture", id: "auto", name: "Offline router",
    route(request) {
      routes++;
      assert.equal(request.reason, "direct");
      assert.ok(request.signal instanceof AbortSignal);
      return { model, thinkingLevel: "off" };
    },
  });
  selectedModel = registry.find("autoname-router-fixture", "auto");
  assert.ok(selectedModel);
  user("验证虚拟模型路由");
  faux.setResponses([fauxAssistantMessage("虚拟模型命名验证")]);
  await runner.getCommand("autoname").handler("", runner.createCommandContext());
  assert.equal(session.getSessionName(), "虚拟模型命名验证");
  assert.equal(routes, 1);
  assert.equal(titles.at(-1), "π - 虚拟模型命名验证");
  assert.ok(titles.some(title => title.startsWith("π - ⠋ - ")), "naming calls must animate the title");

  writeConfig({ enabled: false });
  await runner.emit({ type: "agent_start" });
  assert.equal(titles.at(-1), "π - ⠋ - 虚拟模型命名验证");
  await runner.emit({ type: "agent_end", messages: [] });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.ok(titles.includes("π - ⠙ - 虚拟模型命名验证"), "agent_end must not stop subsequent animation frames");
  assert.match(titles.at(-1), /^π - [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] - /);
  await runner.emit({ type: "agent_settled", messages: [] });
  assert.equal(titles.at(-1), "π - 虚拟模型命名验证");
  await runner.emit({ type: "agent_start" });
  await runner.emit({ type: "session_shutdown", reason: "reload" });
  const count = titles.length;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(titles.length, count, "shutdown must stop the animation");
  runner = await start("rpc");
  await runner.emit({ type: "agent_start" });
  await runner.emit({ type: "agent_settled", messages: [] });
  assert.equal(titles.length, count, "RPC must not emit title updates");
  assert.deepEqual(errors, []);
  console.log("PASS: actual Pi loader, runner, in-memory session and keyless ModelRuntime: automatic, manual, reload, redaction, failure fallback, secret fallback rejection, native virtual-model routing, explicit language, thinking suffix, multiline/reasoning-only extraction, bounded local fallback, TUI title animation/settlement/shutdown, RPC silence");
} finally {
  await runner?.emit({ type: "session_shutdown" });
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  rmSync(home, { recursive: true, force: true });
}
