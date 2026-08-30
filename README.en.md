# ai-workbench (AI 工作台)

An open-source **unified manager for local AI services**: manage all the AI services scattered across your directories — those launched by bat scripts, run via Docker Compose, or plain static pages — as cards on a single web page, with start / stop / restart, notes, and one-click open.

> The problem it solves: local AI services keep piling up (SillyTavern, Ollama, agent projects…), each in a different folder, each launched by its own bat file. ai-workbench turns them into cards you can manage in one place.

[中文说明](README.md)

## Features

- 🗂 **Card-based management**: name, description, path (click to copy), per-port status probing, dependencies, tags, and notes
- 📚 **Groups**: create groups and drag projects in; drag cards within a group to reorder; rename / drag-reorder groups, or dissolve them (projects fall back to ungrouped)
- ▶️ **Lifecycle control**: start / stop / restart / open in browser; live status refresh (5s polling)
- 🐳 **Three launcher types**:
  - `script` — bat / cmd / any command (handles bats that detach grandchild processes via `start`: port-based PID lookup + command-line matching fallbacks)
  - `docker` — Docker Compose (start / stop / restart / update = `pull` + `up -d`)
  - `static` — plain static pages, one-click open
- 🤖 **AI-agent friendly**: REST API with a self-describing schema — another AI can register a freshly built project with a single HTTP call
- 🔁 **Self-managing**: the workbench registers itself as a card too — "stop" exits gracefully, and "restart" boots a fresh instance via a detached helper (the page reconnects after a brief blip)
- 🧩 **Extensible**: a new launcher type = one file + one registration line; frontend buttons render from capability declarations
- 📋 **Logs**: per-project output viewer (in-memory ring buffer + `data/logs/` on disk)
- 🌗 **Light / dark theme**: one click in the header; follows the system preference by default and remembers your manual choice
- 🔒 **Local-first**: binds to `127.0.0.1` by default; optional `WORKBENCH_TOKEN` for write auth
- 📦 **Lightweight**: one backend dependency (express), zero-dependency build-free frontend

## Quick start

Requirements: Windows 10/11 + Node.js ≥ 18 (Docker Desktop needed for the docker launcher).

```bat
git clone https://github.com/roseion/ai-workbench.git ai-workbench
cd ai-workbench
npm install
npm start
```

Or double-click **`scripts\启动工作台.bat`** (idempotent: just opens the browser if already running).

Open **http://127.0.0.1:8787**. On first run the seed data in `data/projects.example.json` initializes the project list.

> The default port 8787 can be changed via `WORKBENCH_PORT`; the bind address via `WORKBENCH_HOST` (defaults to `127.0.0.1` — avoid exposing it publicly).

## Launcher types

| Field | script | docker | static |
|---|---|---|---|
| `path` | bat/cmd/exe path | **directory containing the compose file** | HTML file or directory |
| `ports` | status probing + process lookup on stop | status probing (compose ps first) | n/a |
| `urls` | targets for the "open" button (multiple allowed) | same | file:/// or http URLs |
| `options.composeFile` | — | default `docker-compose.yml` | — |
| `options.processMatch` | kill-fallback by command-line keyword (e.g. `daemon.mjs`) | — | — |
| `options.command` | custom start command (overrides path) | — | — |
| `options.console` | `true` runs in a new console window (double-click equivalent; for bats that misparse when output is redirected — log capture is disabled then) | — | — |
| `options.cwd` / `env` / `encoding` | workdir / env vars / output encoding (e.g. `gbk`) | — | — |

**Stop strategy (script type):** bats commonly `start` their services and exit, breaking the process tree. The workbench stops in three layers: ① tracked PIDs from this launch → `taskkill /T /F`; ② PIDs found listening on the declared `ports`; ③ `options.processMatch` command-line matching. If nothing matches it says so honestly instead of killing blindly.

## Register projects from AI agents

Any AI or script that can send HTTP can register a new project:

```bash
curl -X POST "http://127.0.0.1:8787/api/v1/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My New RAG Service",
    "type": "script",
    "description": "FastAPI RAG gateway",
    "path": "D:/ai/my-rag/start.bat",
    "ports": [8901],
    "urls": ["http://127.0.0.1:8901"],
    "tags": ["RAG"]
  }'
```

- Field spec: `GET /api/v1/schema/project` (self-describing JSON Schema)
- Full integration guide (PowerShell / Python / Node examples, upsert idempotent registration, lifecycle actions): **[docs/API.md](docs/API.md)** (Chinese; the schema and examples are language-agnostic)

## Extending

Add a file under `server/launchers/` implementing the common interface, then register it:

```js
// server/launchers/my-type.js
module.exports = {
  capabilities: { canStart: true, canStop: true, canRestart: false, canOpen: true },
  async start(project)  { /* ... */ return { ok: true, message: 'started' }; },
  async stop(project)   { return { ok: true, message: 'stopped' }; },
  async restart(project) { /* ... */ },
  async getStatus(project) { return { status: 'running' }; }, // running/stopped/starting/unknown/idle
  openUrls: require('./base').openUrls,
};

// append in server/launchers/index.js
register('my-type', require('./my-type'));
```

Card buttons render from `capabilities` and REST validation picks up the new type automatically — no frontend changes needed.

## Testing

```bash
npm test
```

20 tests cover the store, validation, port probing, the launcher registry, and — most importantly — a **full end-to-end integration test**: a fixture bat mimics the real-world "`start` a grandchild then exit" pattern and the suite verifies create → start → port probing → stop (kill tree via port lookup) → delete.

## Known limitations

- Processes started *outside* the workbench with no ports (GUI apps) cannot be identified or stopped — they show as "unknown" and can be marked manually; instances started by the workbench are tracked normally
- stdout of services that a bat detaches via `start` stays in their own windows/log files; the workbench log only captures the main script's output
- `options.processMatch` matches processes by command line — use keywords unique enough to avoid killing the wrong process
- **Some bats are incompatible with output redirection**: cmd may misparse a bat containing `chcp` + Chinese comments when its output is redirected (pipe/file) — double-clicking works, but starting via the workbench fails with error 9009. Set `options.console: true` for such projects (runs in a new console window, double-click equivalent; log capture is disabled)

## License

[MIT](LICENSE)
