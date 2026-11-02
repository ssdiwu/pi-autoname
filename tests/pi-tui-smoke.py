#!/usr/bin/env python3
"""Optional Linux/macOS PTY smoke test. Uses an offline faux provider, never credentials."""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import time

host = Path(os.environ["PI_HOST_ROOT"]).resolve()
root = Path(__file__).resolve().parent.parent
ai_dist = next(path for path in (
    host / "node_modules/@earendil-works/pi-ai/dist",
    host.parent / "pi-ai/dist",
) if (path / "providers/faux.js").is_file())

with tempfile.TemporaryDirectory(prefix="pi-autoname-tui-") as temporary:
    home = Path(temporary)
    project = home / "project"
    project.mkdir()
    agent = home / ".pi/agent"
    agent.mkdir(parents=True)
    (agent / "pi-autoname.json").write_text(json.dumps({"enabled": False, "titleSpinner": True}))
    (agent / "settings.json").write_text(json.dumps({"quietStartup": True}))
    fixture = home / "fixture.ts"
    fixture.write_text(f"""
import {{ fauxProvider, fauxAssistantMessage }} from {json.dumps(str(ai_dist / 'providers/faux.js'))};
export default function (pi) {{
  const faux = fauxProvider({{
    provider: "title-fixture",
    models: [{{ id: "offline", name: "Offline title fixture", reasoning: true }}],
    tokensPerSecond: 30,
    tokenSize: {{ min: 1, max: 1 }},
  }});
  pi.registerProvider(faux.provider);
  pi.on("session_start", () => {{
    faux.setResponses(Array.from({{ length: 5 }}, () => fauxAssistantMessage([
      {{ type: "thinking", thinking: "Checking an offline terminal title animation." }},
      {{ type: "text", text: "Offline fixture completed successfully." }},
    ])));
  }});
}}
""")
    # Deliberately do not inherit credentials, user Pi settings, or debug-output paths.
    environment = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "TERM": "xterm-256color",
        "LANG": "C.UTF-8",
        "PI_CODING_AGENT_DIR": str(agent),
        "PI_OFFLINE": "1",
        "PI_TELEMETRY": "0",
        "JITI_FS_CACHE": "false",
    }
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 35, 120, 0, 0))
    process = subprocess.Popen([
        shutil.which("node") or "node", str(host / "dist/cli.js"),
        "--offline", "--no-session", "--no-extensions",
        "--extension", str(root / "index.ts"), "--extension", str(fixture),
        "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
        "--no-mcp", "--no-tools", "--no-approve",
        "--model", "title-fixture/offline", "--name", "Spinner fixture",
    ], cwd=project, env=environment, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    output = bytearray()

    def pump(seconds=0.05):
        if select.select([master], [], [], seconds)[0]:
            try:
                output.extend(os.read(master, 65536))
            except OSError:
                pass

    def titles():
        return [value.decode("utf-8", errors="replace") for value in re.findall(rb"\x1b\]0;([^\x07]*)\x07", output)]

    def wait_for(predicate, message, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            pump()
            if predicate():
                return
            if process.poll() is not None:
                break
        # The child can exit between the predicate and the second poll above.
        if predicate():
            return
        raise AssertionError(f"{message}\nTitles: {titles()}\nOutput tail: {bytes(output[-5000:])!r}")

    def drain(seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            pump()

    def send(text):
        os.write(master, text.encode())

    def animated(values):
        return [title for title in values if re.match(r"^π - [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] - ", title)]

    try:
        wait_for(lambda: titles() and titles()[-1] == "π - Spinner fixture", "startup title")
        drain(0.3)
        assert titles()[-1] == "π - Spinner fixture", "host startup must not overwrite the final title"
        start = len(titles())
        send("Exercise the offline title animation\r")
        wait_for(lambda: len(set(animated(titles()[start:]))) >= 3, "three distinct spinner frames during inference")
        wait_for(lambda: titles()[-1] == "π - Spinner fixture", "normal completion restores idle title")
        idle_count = len(titles())
        drain(0.4)
        assert len(titles()) == idle_count, "idle titles must not keep polling"
        send("/name Manual fixture\r")
        wait_for(lambda: titles()[-1] == "π - Manual fixture", "manual name refresh")
        reload_start = len(titles())
        send("/reload\r")
        wait_for(lambda: len(titles()) > reload_start, "reload lifecycle")
        drain(1.0)
        assert titles()[-1] == "π - Manual fixture", "reload restores the new idle title"
        start = len(titles())
        send("Exercise cancellation after reload\r")
        wait_for(lambda: len(set(animated(titles()[start:]))) >= 3, "spinner still works after reload")
        send("\x1b")
        wait_for(lambda: titles()[-1] == "π - Manual fixture", "Escape cancellation clears the spinner")
        idle_count = len(titles())
        drain(0.4)
        assert len(titles()) == idle_count, "cancelled/reloaded timers must be stopped"
        send("\x04")
        wait_for(lambda: process.poll() is not None, "clean shutdown")
        assert process.returncode == 0, f"Pi exited with {process.returncode}"
        print("PASS: real Pi TUI/PTY: startup, animated inference, idle/no polling, manual name, /reload, Escape cancellation, clean shutdown (offline provider)")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        os.close(master)
