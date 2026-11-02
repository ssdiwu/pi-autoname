import type { AutonameConfig, DialoguePart, RenameMarker } from "./lib.ts";

export type NamingState = "unnamed" | "named" | "fallback";
export type NamingSource = "ai" | "fallback";
export type NamingMode = "initial" | "periodic" | "manual";

export interface NamingRequest {
  mode: NamingMode;
  currentName?: string;
  signal: AbortSignal;
  /** Snapshot including the assistant response before Pi persists message_end. */
  dialogue?: DialoguePart[];
}

export interface NamingResult {
  name: string;
  source: NamingSource;
}

export interface NamingControllerRuntime {
  now(): number;
  getConfig(): AutonameConfig;
  getCurrentName(): string | undefined;
  appendMarker(marker: { name: string; source: NamingSource; timestamp: number; provisional?: boolean } | { event: "user_rename"; name: string; timestamp: number }): void;
  setSessionName(name: string): void;
  generateName(request: NamingRequest): Promise<NamingResult | undefined>;
  debug(message: string): void;
}

export interface NamingController {
  restore(marker: RenameMarker | undefined, existingName: string | undefined): void;
  handleSessionNameChange(name: string | undefined): void;
  handleResponse(dialogue: DialoguePart[]): Promise<void>;
  handleSettled(): Promise<void>;
  renameManually(): Promise<NamingResult | undefined>;
  shutdown(): void;
}

export function normalizeName(name: string | undefined): string | undefined {
  const normalized = name?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

export function createNamingController(runtime: NamingControllerRuntime): NamingController {
  let state: NamingState = "unnamed";
  let lastRenameTime = 0;
  const pendingNameEchoes: string[] = [];
  let manualName: string | undefined;
  let requestSequence = 0;
  let activeRequest: AbortController | undefined;
  let earlyAttempted = false;
  let needsRefinement = false;

  const applyResult = (result: NamingResult, sequence: number, provisional: boolean): NamingResult | undefined => {
    if (sequence !== requestSequence) {
      runtime.debug("skip stale naming result");
      return undefined;
    }

    const name = normalizeName(result.name);
    if (!name) return undefined;

    const now = runtime.now();
    const currentName = normalizeName(runtime.getCurrentName());
    manualName = undefined;
    if (name !== currentName) {
      // Consume only the event caused by this write, including delayed dispatch.
      // A later /name with the same value is still an explicit manual choice.
      pendingNameEchoes.push(name);
      runtime.setSessionName(name);
      runtime.debug("session name updated");
    } else {
      runtime.debug("session name already current");
    }

    runtime.appendMarker({ name, source: result.source, timestamp: now, ...(provisional ? { provisional: true } : {}) });
    state = result.source === "ai" ? "named" : "fallback";
    lastRenameTime = now;
    return { ...result, name };
  };

  const rename = async (mode: NamingMode, dialogue?: DialoguePart[], provisional = false): Promise<NamingResult | undefined> => {
    const config = runtime.getConfig();
    if (config.enabled === false) return undefined;

    activeRequest?.abort(new Error("Superseded by a newer naming request"));
    const controller = new AbortController();
    activeRequest = controller;
    const sequence = ++requestSequence;

    try {
      const result = await runtime.generateName({
        mode,
        currentName: normalizeName(runtime.getCurrentName()),
        signal: controller.signal,
        ...(dialogue ? { dialogue } : {}),
      });
      return result ? applyResult(result, sequence, provisional) : undefined;
    } catch {
      if (!controller.signal.aborted) {
        runtime.debug("naming request failed");
      }
      return undefined;
    } finally {
      if (activeRequest === controller) activeRequest = undefined;
    }
  };

  return {
    restore(marker, existingName) {
      const existing = normalizeName(existingName);
      pendingNameEchoes.length = 0;
      manualName = undefined;
      lastRenameTime = 0;
      earlyAttempted = false;
      needsRefinement = false;

      if (existing && marker?.name === existing) {
        lastRenameTime = marker.timestamp || runtime.now();
        if (marker.kind === "user_rename") {
          state = "named";
          manualName = existing;
          return;
        }
        state = marker.source === "ai" ? "named" : "fallback";
        needsRefinement = marker.provisional === true;
        return;
      }

      state = "unnamed";
      lastRenameTime = runtime.now();
    },

    handleSessionNameChange(name) {
      const normalized = normalizeName(name);
      if (!normalized) return;
      const echoIndex = pendingNameEchoes.indexOf(normalized);
      if (echoIndex !== -1) {
        pendingNameEchoes.splice(echoIndex, 1);
        return;
      }

      // An explicit rename wins over any background request already in flight.
      requestSequence += 1;
      activeRequest?.abort(new Error("Session renamed manually"));
      activeRequest = undefined;
      earlyAttempted = true;
      needsRefinement = false;
      manualName = normalized;
      lastRenameTime = runtime.now();
      state = "named";
      runtime.appendMarker({ event: "user_rename", name: normalized, timestamp: lastRenameTime });
      runtime.debug("manual session name observed");
    },

    async handleResponse(dialogue) {
      if (earlyAttempted || activeRequest || state !== "unnamed" || normalizeName(runtime.getCurrentName())) return;
      if (runtime.getConfig().enabled === false) return;
      if (!dialogue.some(part => part.role === "user" && part.text.trim()) ||
          !dialogue.some(part => part.role === "assistant" && part.text.trim())) return;
      earlyAttempted = true;
      needsRefinement = true;
      await rename("initial", dialogue, true);
    },

    async handleSettled() {
      const config = runtime.getConfig();
      if (config.enabled === false || (config.respectManualName && manualName)) return;

      if (needsRefinement) {
        // Full task context supersedes any still-running first-pair request.
        needsRefinement = false;
        await rename("periodic");
        return;
      }
      if (activeRequest) return;

      // Completed fallback names use the same cooldown as AI names.
      // Provisional fallbacks already received their one-time refinement above.
      if (state === "unnamed") {
        await rename("initial");
        return;
      }

      const cooldownMs = (config.cooldownMinutes ?? 10) * 60_000;
      if (runtime.now() - lastRenameTime < cooldownMs) return;
      await rename("periodic");
    },

    async renameManually() {
      earlyAttempted = true;
      needsRefinement = false;
      return rename("manual");
    },

    shutdown() {
      requestSequence += 1;
      activeRequest?.abort(new Error("Session shut down"));
      activeRequest = undefined;
    },
  };
}
