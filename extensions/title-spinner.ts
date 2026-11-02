import { basename } from "node:path";

export const TITLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export const TITLE_FRAME_MS = 120;

/** OSC titles must never contain terminal control characters, even in manual names. */
function cleanTitle(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(/\s+/g, " ").trim();
}

export function formatTerminalTitle(name: string | undefined, cwd: string, frame?: string): string {
  const title = cleanTitle(name ?? "") || cleanTitle(basename(cwd)) || "Untitled";
  return frame ? `π - ${frame} - ${title}` : `π - ${title}`;
}

export interface TitleSpinnerRuntime {
  cwd: string;
  getSessionName(): string | undefined;
  setTitle(title: string): void;
}

/** Session-scoped, TUI-only presentation. Never writes session names or markers. */
export function createTitleSpinner(runtime: TitleSpinnerRuntime) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let deferredRefresh: ReturnType<typeof setTimeout> | undefined;
  let frameIndex = 0;
  let agentBusy = false;
  let disposed = false;
  const namingTasks = new Set<() => void>();

  const isBusy = () => agentBusy || namingTasks.size > 0;
  const refresh = () => {
    if (disposed) return;
    runtime.setTitle(formatTerminalTitle(runtime.getSessionName(), runtime.cwd, isBusy() ? TITLE_FRAMES[frameIndex] : undefined));
  };
  const sync = () => {
    if (disposed) return;
    if (isBusy()) {
      if (!timer) {
        frameIndex = 0;
        timer = setInterval(() => {
          frameIndex = (frameIndex + 1) % TITLE_FRAMES.length;
          refresh();
        }, TITLE_FRAME_MS);
        timer.unref?.();
      }
    } else {
      if (timer) clearInterval(timer);
      timer = undefined;
      frameIndex = 0;
    }
    refresh();
  };

  return {
    refresh,
    // Pi also sets its default title during session binding. Reapply after that
    // synchronous/async binding chain without keeping a polling timer while idle.
    refreshAfterHost() {
      if (disposed) return;
      refresh();
      if (deferredRefresh) clearTimeout(deferredRefresh);
      deferredRefresh = setTimeout(() => {
        deferredRefresh = undefined;
        refresh();
      }, 0);
      deferredRefresh.unref?.();
    },
    setAgentBusy(busy: boolean) {
      if (disposed) return;
      agentBusy = busy;
      sync();
    },
    trackNaming(signal: AbortSignal): () => void {
      if (disposed || signal.aborted) return () => {};
      const finish = () => {
        signal.removeEventListener("abort", finish);
        if (namingTasks.delete(finish)) sync();
      };
      namingTasks.add(finish);
      signal.addEventListener("abort", finish, { once: true });
      sync();
      return finish;
    },
    shutdown() {
      if (disposed) return;
      disposed = true;
      if (timer) clearInterval(timer);
      if (deferredRefresh) clearTimeout(deferredRefresh);
      timer = undefined;
      deferredRefresh = undefined;
      // Remove abort listeners too; late naming results cannot touch a new session.
      for (const finish of namingTasks) finish();
      runtime.setTitle(formatTerminalTitle(runtime.getSessionName(), runtime.cwd));
    },
  };
}
