import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createNamingController,
  normalizeName,
  type NamingControllerRuntime,
  type NamingRequest,
  type NamingResult,
} from "../extensions/controller.ts";
import { DEFAULT_CONFIG, type AutonameConfig } from "../extensions/lib.ts";

function createRuntime(options: {
  config?: AutonameConfig;
  name?: string;
  generated?: NamingResult | undefined;
  generate?: (request: NamingRequest) => Promise<NamingResult | undefined>;
} = {}) {
  let now = 1_000;
  let name = options.name;
  const markers: unknown[] = [];
  const requests: NamingRequest[] = [];
  const setNames: string[] = [];
  const runtime: NamingControllerRuntime = {
    now: () => now,
    getConfig: () => ({ ...DEFAULT_CONFIG, ...options.config }),
    getCurrentName: () => name,
    appendMarker: (marker) => markers.push(marker),
    setSessionName: (next) => {
      name = next;
      setNames.push(next);
    },
    generateName: async (request) => {
      requests.push(request);
      return options.generate ? options.generate(request) : options.generated;
    },
    debug: () => {},
  };
  return {
    controller: createNamingController(runtime),
    requests,
    markers,
    setNames,
    get name() { return name; },
    renameExternally(next: string) { name = next; },
    advance(milliseconds: number) { now += milliseconds; },
  };
}

describe("naming lifecycle", () => {
  it("names a fresh session after it settles and persists an AI marker", async () => {
    const test = createRuntime({ generated: { name: "语义化标题", source: "ai" } });
    test.controller.restore(undefined, undefined);

    await test.controller.handleSettled();

    assert.equal(test.name, "语义化标题");
    assert.deepEqual(test.requests.map((request) => request.mode), ["initial"]);
    assert.deepEqual(test.markers, [{ name: "语义化标题", source: "ai", timestamp: 1_000 }]);
  });

  it("persists a trusted ticket prefix across later renames", async () => {
    const test = createRuntime({
      generated: { name: "ABC-123 initial", source: "ai", ticketPrefix: "ABC-123" },
    });
    test.controller.restore(undefined, undefined);

    await test.controller.handleSettled();
    assert.deepEqual(test.markers.at(-1), {
      name: "ABC-123 initial", source: "ai", ticketPrefix: "ABC-123", timestamp: 1_000,
    });

    test.advance(11 * 60_000);
    await test.controller.handleSettled();
    assert.equal(test.requests.at(-1)?.ticketPrefix, "ABC-123");
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
