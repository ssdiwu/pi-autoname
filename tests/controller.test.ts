import { describe, expect, it, vi } from "vitest";
import { createNamingController } from "../extensions/controller.js";

function runtime(overrides: Partial<{
  name: string | undefined;
  now: number;
  generateName: (request: any) => Promise<any>;
}> = {}) {
  let name = overrides.name;
  const markers: any[] = [];
  const generateName = overrides.generateName ?? vi.fn(async () => ({ name: "Автоматическое имя", source: "ai" }));
  return {
    markers,
    get name() { return name; },
    now: () => overrides.now ?? 1_000,
    getConfig: () => ({ enabled: true, cooldownMinutes: 10, respectManualName: true }),
    getCurrentName: () => name,
    appendMarker: (marker: any) => markers.push(marker),
    setSessionName: (next: string) => { name = next; },
    generateName,
    debug: vi.fn(),
  };
}

describe("createNamingController", () => {
  it("protects a name observed through session_info_changed by default", async () => {
    const rt = runtime({ name: "AI имя", now: 10_000 });
    const controller = createNamingController(rt);
    controller.restore({ kind: "ai", name: "AI имя", source: "ai", timestamp: 1 }, "AI имя");

    rt.setSessionName("Моё имя");
    controller.handleSessionNameChange("Моё имя");
    await controller.handleSettled();

    expect(rt.name).toBe("Моё имя");
    expect(rt.generateName).not.toHaveBeenCalled();
    expect(rt.markers.at(-1)).toMatchObject({ event: "user_rename", name: "Моё имя" });
  });

  it("ignores a result from a request superseded by a newer request", async () => {
    let resolveFirst!: (value: any) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const rt = runtime({
      generateName: vi.fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce({ name: "Новое имя", source: "ai" }),
    });
    const controller = createNamingController(rt);
    controller.restore(undefined, undefined);

    const firstRequest = controller.handleSettled();
    const secondRequest = controller.renameManually();
    resolveFirst({ name: "Устаревшее имя", source: "ai" });
    await Promise.all([firstRequest, secondRequest]);

    expect(rt.name).toBe("Новое имя");
    expect(rt.markers.filter((marker) => marker.source === "ai")).toHaveLength(1);
  });

  it("does not let an in-flight automatic result overwrite a manual rename", async () => {
    let resolveRequest!: (value: any) => void;
    const pending = new Promise((resolve) => { resolveRequest = resolve; });
    const rt = runtime({
      name: "AI имя",
      generateName: vi.fn().mockReturnValue(pending),
    });
    const controller = createNamingController(rt);
    controller.restore({ kind: "ai", name: "AI имя", source: "ai", timestamp: 1 }, "AI имя");

    const request = controller.handleSettled();
    rt.setSessionName("Моё ручное имя");
    controller.handleSessionNameChange("Моё ручное имя");
    resolveRequest({ name: "Запоздалое AI имя", source: "ai" });
    await request;

    expect(rt.name).toBe("Моё ручное имя");
    expect(rt.markers.at(-1)).toMatchObject({ event: "user_rename", name: "Моё ручное имя" });
  });

  it("restores the pinned ticket prefix from an automatic marker", async () => {
    const rt = runtime({
      name: "ABC-123 Старое имя",
      now: 700_000,
      generateName: vi.fn(async ({ ticketPrefix }) => ({ name: `${ticketPrefix} Новое имя`, source: "ai" })),
    });
    const controller = createNamingController(rt);
    controller.restore({ kind: "ai", name: "ABC-123 Старое имя", source: "ai", timestamp: 5, ticketPrefix: "ABC-123" }, rt.name);
    await controller.handleSettled();
    expect(rt.name).toBe("ABC-123 Новое имя");
    expect(rt.generateName).toHaveBeenCalledWith(expect.objectContaining({ ticketPrefix: "ABC-123" }));
  });
});
