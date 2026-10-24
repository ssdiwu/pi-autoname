// Offline end-to-end lifecycle check: a real Pi AgentSession and a gated fixture tool.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.env.PI_HOST_ROOT) throw new Error("Set PI_HOST_ROOT to the installed Pi package directory");
const host = resolve(process.env.PI_HOST_ROOT);
const root = fileURLToPath(new URL("../", import.meta.url));
const ai = [join(host, "node_modules/@earendil-works/pi-ai"), resolve(host, "../pi-ai")]
  .find(path => existsSync(join(path, "dist/providers/faux.js")));
assert.ok(ai, "Pi's faux provider must be installed");
const home = mkdtempSync(join(tmpdir(), "pi-early-naming-"));
const agentDir = join(home, ".pi", "agent");
const oldEnvironment = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, JITI_FS_CACHE: process.env.JITI_FS_CACHE };
process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.JITI_FS_CACHE = "false";
let session;
try {
  const { createAgentSession, ModelRuntime, SessionManager, SettingsManager } = await import(pathToFileURL(join(host, "dist/index.js")).href);
  const { loadExtensions } = await import(pathToFileURL(join(host, "dist/core/extensions/loader.js")).href);
  const { InMemoryCredentialStore } = await import(pathToFileURL(join(ai, "dist/auth/credential-store.js")).href);
  const { fauxProvider, fauxAssistantMessage } = await import(pathToFileURL(join(ai, "dist/providers/faux.js")).href);
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const main = fauxProvider({ provider: "early-main-fixture", tokensPerSecond: Infinity });
  const naming = fauxProvider({ provider: "early-title-fixture", tokensPerSecond: Infinity });
  runtime.registerNativeProvider(main.provider);
  runtime.registerNativeProvider(naming.provider);
  const namingModel = naming.getModel();
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "pi-autoname.json"), JSON.stringify({ model: `${namingModel.provider}/${namingModel.id}`, respectManualName: true }));
  const loaded = await loadExtensions([join(root, "index.ts")], home);
  assert.deepEqual(loaded.errors, []);
  const resourceLoader = {
    getExtensions: () => loaded,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "Offline fixture only.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  const manager = SessionManager.inMemory(home);
  let settled = false;
  let toolObservedTitle = false;
  const errors = [];
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(predicate(), label);
  };
  ({ session } = await createAgentSession({
    cwd: home, agentDir, resourceLoader, modelRuntime: runtime, model: main.getModel(), thinkingLevel: "off",
    sessionManager: manager, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    tools: ["gated_fixture"],
    customTools: [{
      name: "gated_fixture", label: "Gated fixture", description: "Wait for the early title without completing the task.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        await waitFor(() => manager.getSessionName() === "Database diagnostics", "initial name must arrive while the tool is still running");
        assert.equal(settled, false);
        assert.equal(naming.state.callCount, 1);
        toolObservedTitle = true;
        return { content: [{ type: "text", text: "Found a connection pool leak" }], details: {} };
      },
    }],
  }));
  session.subscribe(event => { if (event.type === "agent_settled") settled = true; });
  await session.bindExtensions({ onError: error => errors.push(error) });
  main.setResponses([
    fauxAssistantMessage([
      { type: "text", text: "Investigating database connection failures" },
      { type: "toolCall", id: "gate-1", name: "gated_fixture", arguments: {} },
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("Repaired the leaking connection pool"),
  ]);
  naming.setResponses([
    context => {
      const prompt = JSON.stringify(context);
      assert.match(prompt, /Fix database connections/);
      assert.match(prompt, /Investigating database connection failures/);
      assert.doesNotMatch(prompt, /Repaired the leaking connection pool/);
      return fauxAssistantMessage("Database diagnostics");
    },
    context => {
      assert.match(JSON.stringify(context), /Repaired the leaking connection pool/);
      return fauxAssistantMessage("Connection pool repair");
    },
  ]);
  await session.prompt("Fix database connections");
  await waitFor(() => manager.getSessionName() === "Connection pool repair", "settlement must refine using the finished task");
  assert.equal(toolObservedTitle, true);
  assert.equal(settled, true);
  assert.equal(naming.state.callCount, 2);
  assert.deepEqual(errors, []);
  const markers = manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "pi-autoname-state");
  assert.equal(markers[0].data.provisional, true);
  assert.equal(markers.at(-1).data.provisional, undefined);
  session.setSessionName("Connection pool repair");
  await waitFor(() => manager.getBranch().some(entry => entry.type === "custom" && entry.customType === "pi-autoname-state" && entry.data.event === "user_rename"), "same-name manual choice must be observed through Pi's real event path");
  assert.equal(naming.state.callCount, 2);
  console.log("PASS: actual Pi AgentSession names before a gated tool completes, refines once at settlement, and recognizes a same-name manual choice (offline providers)");
} finally {
  session?.dispose();
  for (const [key, value] of Object.entries(oldEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
}
