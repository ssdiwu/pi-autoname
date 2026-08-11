import type { AutonameConfig, RenameMarker } from "./lib.ts";

export type NamingState = "unnamed" | "named" | "fallback";
export type NamingSource = "ai" | "fallback";
export type NamingMode = "initial" | "periodic" | "manual";

export interface NamingRequest {
  mode: NamingMode;
  currentName?: string;
  ticketPrefix?: string;
  signal: AbortSignal;
}

export interface NamingResult {
  name: string;
  source: NamingSource;
  ticketPrefix?: string;
}

export interface NamingControllerRuntime {
  now(): number;
  getConfig(): AutonameConfig;
  getCurrentName(): string | undefined;
  appendMarker(
    marker:
      | { name: string; source: NamingSource; timestamp: number; ticketPrefix?: string }
      | { event: "user_rename"; name: string; timestamp: number; ticketPrefix?: string },
  ): void;
  setSessionName(name: string): void;
  generateName(request: NamingRequest): Promise<NamingResult | undefined>;
  debug(message: string): void;
}

export interface NamingController {
  restore(marker: RenameMarker | undefined, existingName: string | undefined): void;
  handleSessionNameChange(name: string | undefined): void;
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
  let lastGeneratedName: string | undefined;
  let manualName: string | undefined;
  let ticketPrefix: string | undefined;
  let requestSequence = 0;
  let activeRequest: AbortController | undefined;

  const applyResult = (result: NamingResult, sequence: number): NamingResult | undefined => {
    if (sequence !== requestSequence) {
      runtime.debug(`skip stale naming result: ${result.name}`);
      return undefined;
    }
    const name = normalizeName(result.name);
    if (!name) return undefined;
    const now = runtime.now();
    const currentName = normalizeName(runtime.getCurrentName());
    // Pi emits session_info_changed synchronously/asynchronously from
    // setSessionName. Mark ownership before writing to avoid a false manual
    // rename event.
    lastGeneratedName = name;
    manualName = undefined;
    ticketPrefix = result.ticketPrefix ?? ticketPrefix;
    if (name !== currentName) runtime.setSessionName(name);
    runtime.appendMarker({
      name,
      source: result.source,
      timestamp: now,
      ...(ticketPrefix ? { ticketPrefix } : {}),
    });
    state = result.source === "ai" ? "named" : "fallback";
    lastRenameTime = now;
    return { ...result, name, ...(ticketPrefix ? { ticketPrefix } : {}) };
  };

  const rename = async (mode: NamingMode): Promise<NamingResult | undefined> => {
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
        ticketPrefix,
        signal: controller.signal,
      });
      return result ? applyResult(result, sequence) : undefined;
    } catch (error) {
      if (!controller.signal.aborted) runtime.debug(`naming request failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    } finally {
      if (activeRequest === controller) activeRequest = undefined;
    }
  };

  return {
    restore(marker, existingName) {
      const existing = normalizeName(existingName);
      lastGeneratedName = undefined;
      manualName = undefined;
      ticketPrefix = marker?.ticketPrefix;
      lastRenameTime = 0;
      if (existing && marker?.name === existing) {
        lastRenameTime = marker.timestamp || runtime.now();
        lastGeneratedName = existing;
        if (marker.kind === "user_rename") {
          state = "named";
          manualName = existing;
        } else {
          state = marker.source === "ai" ? "named" : "fallback";
        }
        return;
      }
      state = "unnamed";
      ticketPrefix = undefined;
      lastRenameTime = runtime.now();
    },

    handleSessionNameChange(name) {
      const normalized = normalizeName(name);
      if (!normalized || normalized === lastGeneratedName) return;
      manualName = normalized;
      lastGeneratedName = normalized;
      lastRenameTime = runtime.now();
      state = "named";
      runtime.appendMarker({
        event: "user_rename",
        name: normalized,
        timestamp: lastRenameTime,
        ...(ticketPrefix ? { ticketPrefix } : {}),
      });
      runtime.debug(`manual session name observed: ${normalized}`);
    },

    async handleSettled() {
      const config = runtime.getConfig();
      if (config.enabled === false || (config.respectManualName && manualName)) return;
      if (state === "unnamed" || state === "fallback") {
        await rename("initial");
        return;
      }
      const cooldownMs = (config.cooldownMinutes ?? 10) * 60_000;
      if (runtime.now() - lastRenameTime >= cooldownMs) await rename("periodic");
    },

    renameManually() {
      return rename("manual");
    },

    shutdown() {
      requestSequence += 1;
      activeRequest?.abort(new Error("Session shut down"));
      activeRequest = undefined;
    },
  };
}
