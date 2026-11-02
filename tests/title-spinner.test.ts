import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTitleSpinner, formatTerminalTitle, TITLE_FRAME_MS, TITLE_FRAMES } from "../extensions/title-spinner.ts";

function setup(t: any) {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const titles: string[] = [];
  let name: string | undefined = "Database retries";
  const spinner = createTitleSpinner({
    cwd: "/projects/app",
    getSessionName: () => name,
    setTitle: (title) => titles.push(title),
  });
  t.after(() => spinner.shutdown());
  return { spinner, titles, rename: (next: string | undefined) => { name = next; } };
}

describe("terminal title spinner", () => {
  it("uses the Pi symbol and falls back to the working directory for unnamed sessions", () => {
    assert.equal(formatTerminalTitle("Database retries", "/projects/app", "⠋"), "π - ⠋ - Database retries");
    assert.equal(formatTerminalTitle("Database retries", "/projects/app"), "π - Database retries");
    assert.equal(formatTerminalTitle(undefined, "/projects/app", "⠋"), "π - ⠋ - app");
    assert.equal(formatTerminalTitle("  ", "/"), "π - Untitled");
  });

  it("removes OSC terminators, escape characters, C1 controls and line breaks", () => {
    const title = formatTerminalTitle("Task\x07\x1b\x9c\nwith\ttabs\r\x00", "/projects/app");
    assert.equal(title, "π - Task with tabs");
    assert.doesNotMatch(title, /[\u0000-\u001f\u007f-\u009f]/);
    assert.equal(formatTerminalTitle(undefined, "/projects/bad\x07dir"), "π - baddir");
  });

  it("animates immediately, wraps frames, and stops all ticks when idle", t => {
    const { spinner, titles } = setup(t);
    spinner.setAgentBusy(true);
    assert.equal(titles.at(-1), "π - ⠋ - Database retries");
    for (let i = 1; i <= TITLE_FRAMES.length; i++) {
      t.mock.timers.tick(TITLE_FRAME_MS);
      assert.equal(titles.at(-1), `π - ${TITLE_FRAMES[i % TITLE_FRAMES.length]} - Database retries`);
    }
    spinner.setAgentBusy(false);
    assert.equal(titles.at(-1), "π - Database retries");
    const stopped = titles.length;
    t.mock.timers.tick(TITLE_FRAME_MS * 10);
    assert.equal(titles.length, stopped);
  });

  it("does not duplicate timers or reset frames across repeated agent starts", t => {
    const { spinner, titles } = setup(t);
    spinner.setAgentBusy(true);
    t.mock.timers.tick(TITLE_FRAME_MS);
    spinner.setAgentBusy(true);
    assert.equal(titles.at(-1), "π - ⠙ - Database retries");
    const count = titles.length;
    t.mock.timers.tick(TITLE_FRAME_MS);
    assert.equal(titles.length, count + 1);
    assert.equal(titles.at(-1), "π - ⠹ - Database retries");
  });

  it("reads live names and preserves the animation when renamed", t => {
    const { spinner, titles, rename } = setup(t);
    spinner.setAgentBusy(true);
    rename("Manual title");
    spinner.refresh();
    assert.equal(titles.at(-1), "π - ⠋ - Manual title");
    rename(undefined);
    t.mock.timers.tick(TITLE_FRAME_MS);
    assert.equal(titles.at(-1), "π - ⠙ - app");
  });

  it("keeps overlapping main-agent and naming work independently busy", t => {
    const { spinner, titles } = setup(t);
    const first = spinner.trackNaming(new AbortController().signal);
    const second = spinner.trackNaming(new AbortController().signal);
    first();
    first();
    assert.match(titles.at(-1)!, /π - ⠋ -/);
    spinner.setAgentBusy(true);
    second();
    t.mock.timers.tick(TITLE_FRAME_MS);
    assert.match(titles.at(-1)!, /π - ⠙ -/);
    spinner.setAgentBusy(false);
    assert.equal(titles.at(-1), "π - Database retries");
  });

  it("releases cancelled naming immediately even if the provider never resolves", t => {
    const { spinner, titles } = setup(t);
    const request = new AbortController();
    const finish = spinner.trackNaming(request.signal);
    request.abort();
    assert.equal(titles.at(-1), "π - Database retries");
    const count = titles.length;
    spinner.trackNaming(request.signal)();
    finish();
    t.mock.timers.tick(TITLE_FRAME_MS * 10);
    assert.equal(titles.length, count);
  });

  it("reapplies the title after host binding without ongoing idle polling", t => {
    const { spinner, titles } = setup(t);
    spinner.refreshAfterHost();
    titles.push("host default title");
    t.mock.timers.tick(1);
    assert.equal(titles.at(-1), "π - Database retries");
    const count = titles.length;
    t.mock.timers.tick(TITLE_FRAME_MS * 10);
    assert.equal(titles.length, count);
  });

  it("shuts down idempotently and makes late callbacks and events inert", t => {
    const { spinner, titles } = setup(t);
    const request = new AbortController();
    spinner.refreshAfterHost();
    spinner.setAgentBusy(true);
    const finish = spinner.trackNaming(request.signal);
    spinner.shutdown();
    assert.equal(titles.at(-1), "π - Database retries");
    const count = titles.length;
    spinner.shutdown();
    spinner.refresh();
    spinner.refreshAfterHost();
    spinner.setAgentBusy(true);
    spinner.trackNaming(new AbortController().signal)();
    request.abort();
    finish();
    t.mock.timers.tick(TITLE_FRAME_MS * 10);
    assert.equal(titles.length, count);
  });
});
