import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createNamingController,
  normalizeName,
  type NamingControllerRuntime,
  type NamingRequest,
  type NamingResult,
} from "../extensions/controller.ts";
import { DEFAULT_CONFIG, parseRenameMarker, type AutonameConfig, type DialoguePart } from "../extensions/lib.ts";

const firstPair: DialoguePart[] = [
  { role: "user", text: "Fix database connections" },
  { role: "assistant", text: "Inspecting connection failures" },
];

function createRuntime(options: {
  config?: AutonameConfig;
  name?: string;
  deferNameEcho?: boolean;
  generated?: NamingResult | undefined;
  generate?: (request: NamingRequest) => Promise<NamingResult | undefined>;
} = {}) {
  let now = 1_000;
  let name = options.name;
  const markers: unknown[] = [];
  const requests: NamingRequest[] = [];
  const setNames: string[] = [];
  const nameEchoes: string[] = [];
  let controller: ReturnType<typeof createNamingController>;
  const runtime: NamingControllerRuntime = {
    now: () => now,
    getConfig: () => ({ ...DEFAULT_CONFIG, ...options.config }),
    getCurrentName: () => name,
    appendMarker: (marker) => markers.push(marker),
    setSessionName: (next) => {
      name = next;
      setNames.push(next);
      if (options.deferNameEcho) nameEchoes.push(next);
      else controller.handleSessionNameChange(next);
    },
    generateName: async (request) => {
      requests.push(request);
      return options.generate ? options.generate(request) : options.generated;
    },
    debug: () => {},
  };
  controller = createNamingController(runtime);
  return {
    controller,
    flushNameEchoes() {
      for (const echo of nameEchoes.splice(0)) controller.handleSessionNameChange(echo);
    },
    requests,
    markers,
    setNames,
    get name() { return name; },
    renameExternally(next: string) { name = next; },
    advance(milliseconds: number) { now += milliseconds; },
  };
}

describe("naming lifecycle", () => {
  it("attempts an early title once and refines it once before applying the normal cooldown", async () => {
    const test = createRuntime({ generated: { name: "Connection repair", source: "ai" } });
    test.controller.restore(undefined, undefined);
    await test.controller.handleResponse(firstPair);
    await test.controller.handleResponse(firstPair);
    assert.equal(test.requests.length, 1);
    assert.deepEqual(test.requests[0].dialogue, firstPair);
    assert.deepEqual(test.markers[0], { name: "Connection repair", source: "ai", timestamp: 1_000, provisional: true });
    await test.controller.handleSettled();
    await test.controller.handleSettled();
    assert.deepEqual(test.requests.map(request => request.mode), ["initial", "periodic"]);
    assert.deepEqual(test.setNames, ["Connection repair"], "unchanged titles must not be rewritten");
    assert.equal((test.markers.at(-1) as any).provisional, undefined);
  });

  it("restores a provisional marker without bypassing cooldown for legacy markers", async () => {
    const test = createRuntime({ name: "Early title", generated: { name: "Settled title", source: "ai" } });
    test.controller.restore(parseRenameMarker({ name: "Early title", source: "ai", timestamp: 1_000, provisional: true }), "Early title");
    await test.controller.handleSettled();
    assert.equal(test.name, "Settled title");
    assert.deepEqual(test.requests.map(request => request.mode), ["periodic"]);
  });

  it("does not repeatedly request a title after an unsuccessful early attempt", async () => {
    const test = createRuntime();
    test.controller.restore(undefined, undefined);
    await test.controller.handleResponse(firstPair);
    await test.controller.handleResponse(firstPair);
    assert.equal(test.requests.length, 1);
    await test.controller.handleSettled();
    assert.equal(test.requests.length, 2, "settlement still gets a chance with complete context");
  });

  it("deduplicates repeated settlement while refinement is pending", async () => {
    let resolve: any;
    let passes = 0;
    const test = createRuntime({ generate: async () => ++passes === 1
      ? { name: "Early title", source: "ai" }
      : new Promise(done => { resolve = done; }) });
    test.controller.restore(undefined, undefined);
    await test.controller.handleResponse(firstPair);
    const pending = test.controller.handleSettled();
    await test.controller.handleSettled();
    assert.equal(test.requests.length, 2);
    resolve({ name: "Settled title", source: "ai" });
    await pending;
    assert.equal(test.name, "Settled title");
  });

  it("cancels early naming on a manual rename and rejects its late result", async () => {
    for (const respectManualName of [false, true]) {
      let resolve: any;
      const test = createRuntime({ config: { respectManualName }, generate: () => new Promise(done => { resolve = done; }) });
      test.controller.restore(undefined, undefined);
      const pending = test.controller.handleResponse(firstPair);
      test.renameExternally("My chosen title");
      test.controller.handleSessionNameChange("My chosen title");
      assert.equal(test.requests[0].signal.aborted, true);
      resolve({ name: "Stale initial title", source: "ai" });
      await pending;
      await test.controller.handleSettled();
      assert.equal(test.name, "My chosen title");
      assert.equal(test.requests.length, 1, "manual naming cancels the pending settlement refinement");
    }
  });

  it("treats a same-valued manual rename as a choice rather than another generated echo", async () => {
    for (const respectManualName of [false, true]) {
      const test = createRuntime({ config: { respectManualName, cooldownMinutes: 1 }, generated: { name: "Early title", source: "ai" } });
      test.controller.restore(undefined, undefined);
      await test.controller.handleResponse(firstPair);
      test.controller.handleSessionNameChange("Early title");
      assert.deepEqual(test.markers.at(-1), { event: "user_rename", name: "Early title", timestamp: 1_000 });
      await test.controller.handleSettled();
      assert.equal(test.requests.length, 1, "same-name /name must cancel the pending refinement");
      test.advance(2 * 60_000);
      await test.controller.handleSettled();
      assert.equal(test.requests.length, respectManualName ? 1 : 2);
    }
  });

  it("consumes delayed generated echoes without ignoring the next same-name manual event", async () => {
    let resolveRefinement: any;
    let passes = 0;
    const test = createRuntime({ deferNameEcho: true, generate: async () => ++passes === 1
      ? { name: "Early title", source: "ai" }
      : new Promise(resolve => { resolveRefinement = resolve; }) });
    test.controller.restore(undefined, undefined);
    await test.controller.handleResponse(firstPair);
    const pending = test.controller.handleSettled();
    test.flushNameEchoes();
    assert.equal(test.requests[1].signal.aborted, false, "a delayed generated echo is not a manual cancellation");
    resolveRefinement({ name: "Settled title", source: "ai" });
    await pending;
    test.flushNameEchoes();
    test.controller.handleSessionNameChange("Settled title");
    assert.deepEqual(test.markers.at(-1), { event: "user_rename", name: "Settled title", timestamp: 1_000 });
  });

  it("does not refine over an explicit autoname result at settlement", async () => {
    const test = createRuntime({ generated: { name: "Task title", source: "ai" } });
    test.controller.restore(undefined, undefined);
    await test.controller.handleResponse(firstPair);
    await test.controller.renameManually();
    await test.controller.handleSettled();
    assert.deepEqual(test.requests.map(request => request.mode), ["initial", "manual"]);
  });

  it("names a fresh session after it settles and persists an AI marker", async () => {
    const test = createRuntime({ generated: { name: "语义化标题", source: "ai" } });
    test.controller.restore(undefined, undefined);

    await test.controller.handleSettled();

    assert.equal(test.name, "语义化标题");
    assert.deepEqual(test.requests.map((request) => request.mode), ["initial"]);
    assert.deepEqual(test.markers, [{ name: "语义化标题", source: "ai", timestamp: 1_000 }]);
  });

  it("applies cooldown after a fallback refinement without skipping the one-time refinement", async () => {
    for (const earlySource of ["ai", "fallback"] as const) {
      let passes = 0;
      const test = createRuntime({ generate: async () => ({ name: "Connection repair", source: ++passes === 1 ? earlySource : "fallback" }) });
      test.controller.restore(undefined, undefined);
      await test.controller.handleResponse(firstPair);
      await test.controller.handleSettled();
      assert.deepEqual(test.requests.map(request => request.mode), ["initial", "periodic"]);
      await test.controller.handleSettled();
      assert.equal(test.requests.length, 2);
      assert.equal(test.markers.length, 2, "cooldown must prevent duplicate fallback markers too");
      test.advance(10 * 60_000);
      await test.controller.handleSettled();
      assert.deepEqual(test.requests.map(request => request.mode), ["initial", "periodic", "periodic"]);
    }
  });

  it("preserves fallback cooldown after initial settlement and reload", async () => {
    const test = createRuntime({ generated: { name: "Fallback title", source: "fallback" } });
    test.controller.restore(undefined, undefined);
    await test.controller.handleSettled();
    await test.controller.handleSettled();
    assert.equal(test.requests.length, 1);
    const restored = createRuntime({ name: test.name, generated: { name: "Recovered AI title", source: "ai" } });
    restored.controller.restore(parseRenameMarker(test.markers.at(-1)), test.name);
    await restored.controller.handleSettled();
    assert.equal(restored.requests.length, 0);
    restored.advance(10 * 60_000);
    await restored.controller.handleSettled();
    assert.deepEqual(restored.requests.map(request => request.mode), ["periodic"]);
  });

  it("skips periodic renaming before cooldown and names after it", async () => {
    const test = createRuntime({ name: "旧标题", generated: { name: "新标题", source: "ai" } });
    test.controller.restore({ kind: "ai", name: "旧标题", source: "ai", timestamp: 1_000 }, "旧标题");

    test.advance(9 * 60_000);
    await test.controller.handleSettled();
    assert.equal(test.requests.length, 0);

    test.advance(60_000);
    await test.controller.handleSettled();
    assert.deepEqual(test.requests.map((request) => request.mode), ["periodic"]);
    assert.equal(test.name, "新标题");
  });

  it("keeps a user rename sticky when respectManualName is enabled", async () => {
    const test = createRuntime({
      config: { respectManualName: true, cooldownMinutes: 1 },
      name: "AI 标题",
      generated: { name: "不应覆盖", source: "ai" },
    });
    test.controller.restore({ kind: "ai", name: "AI 标题", source: "ai", timestamp: 1_000 }, "AI 标题");
    test.renameExternally("手工标题");
    test.controller.handleSessionNameChange("手工标题");
    test.advance(2 * 60_000);

    await test.controller.handleSettled();

    assert.equal(test.name, "手工标题");
    assert.equal(test.requests.length, 0);
    assert.deepEqual(test.markers.at(-1), { event: "user_rename", name: "手工标题", timestamp: 1_000 });
  });

  it("uses a manual command even when manual names are sticky", async () => {
    const test = createRuntime({
      config: { respectManualName: true },
      name: "手工标题",
      generated: { name: "强制重命名", source: "ai" },
    });
    test.controller.restore({ kind: "user_rename", name: "手工标题", timestamp: 1_000 }, "手工标题");

    const result = await test.controller.renameManually();

    assert.deepEqual(result, { name: "强制重命名", source: "ai" });
    assert.equal(test.name, "强制重命名");
    assert.deepEqual(test.requests.map((request) => request.mode), ["manual"]);
  });

  it("does not rewrite an unchanged name but refreshes its marker and cooldown", async () => {
    const test = createRuntime({ name: "同一个标题", generated: { name: " 同一个标题 ", source: "ai" } });
    test.controller.restore({ kind: "ai", name: "同一个标题", source: "ai", timestamp: 1_000 }, "同一个标题");
    test.advance(11 * 60_000);

    await test.controller.handleSettled();

    assert.deepEqual(test.setNames, []);
    assert.deepEqual(test.markers.at(-1), { name: "同一个标题", source: "ai", timestamp: 661_000 });
  });

  it("cancels a superseded request and ignores its late result", async () => {
    let resolveFirst: ((result: NamingResult | undefined) => void) | undefined;
    const test = createRuntime({
      generate: (request) => new Promise((resolve) => {
        if (request.mode === "initial") resolveFirst = resolve;
        else resolve({ name: "手动标题", source: "ai" });
      }),
    });
    test.controller.restore(undefined, undefined);

    const initial = test.controller.handleSettled();
    const manual = test.controller.renameManually();
    resolveFirst?.({ name: "过期标题", source: "ai" });
    await Promise.all([initial, manual]);

    assert.equal(test.name, "手动标题");
  });

  it("cancels pending naming work on session shutdown", async () => {
    let request: NamingRequest | undefined;
    const test = createRuntime({
      generate: async (candidate) => {
        request = candidate;
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { name: "不应写入", source: "ai" };
      },
    });
    test.controller.restore(undefined, undefined);
    const naming = test.controller.handleSettled();
    test.controller.shutdown();
    await naming;

    assert.equal(request?.signal.aborted, true);
    assert.equal(test.name, undefined);
  });
});

describe("name normalization", () => {
  it("normalizes only presentation-insignificant whitespace", () => {
    assert.equal(normalizeName("  API   重构 "), "API 重构");
    assert.equal(normalizeName("  "), undefined);
  });
});
