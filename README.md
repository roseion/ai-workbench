# AI 工作台 (ai-workbench)

一个开源的**本地 AI 服务统一管理工作台**：用网页卡片管理你散落在各个目录里的 AI 服务——bat 脚本拉起的、Docker Compose 跑的、纯静态页面的，都能在一个页面里启动、停止、重启、备注、一键打开。

> 解决的问题：本地 AI 服务越攒越多（SillyTavern、Ollama、各种 Agent 项目……），每个都在不同目录、靠不同的 bat 拉起，管理起来要一个个翻文件夹。AI 工作台把它们变成一张张卡片，集中管理。

## 特性

- 🗂 **卡片式管理**：项目名称、简介、路径（点击复制）、端口状态（逐端口探测）、依赖项、标签、备注，一卡尽览
- ▶️ **启停控制**：启动 / 停止 / 重启 / 一键打开浏览器；运行状态自动刷新（5s 轮询）
- 🐳 **三种启动器**：
  - `script` —— bat / cmd / 任意命令（支持跟踪 `start` 拉起的孙进程：端口反查 + 命令行匹配双重兜底）
  - `docker` —— Docker Compose（start / stop / restart / 更新 = `pull` + `up -d`）
  - `static` —— 纯静态页面，一键打开
- 🤖 **AI 同事接入**：REST API + 自描述 Schema，其他 AI 建完新项目后，一个 HTTP 请求即可注册进工作台
- 🧩 **可扩展**：新增启动器类型 = 一个文件 + 一行注册，前端按钮按能力声明自动渲染
- 📋 **日志查看**：每个项目的启动输出就地查看（内存环形缓冲 + 落盘 `data/logs/`）
- 🔒 **本地优先**：默认只监听 `127.0.0.1`；可选 `WORKBENCH_TOKEN` 为写操作加鉴权
- 📦 **轻量**：后端仅一个 npm 依赖（express），前端零依赖零构建

## 快速开始

环境要求：Windows 10/11 + Node.js ≥ 18（使用 Docker 启动器需要 Docker Desktop）。

```bat
git clone <repo-url> ai-workbench
cd ai-workbench
npm install
npm start
```

或直接双击 **`scripts\启动工作台.bat`**（幂等：已在运行则只打开浏览器）。

浏览器访问 **http://127.0.0.1:8787**。首次启动会自动用 `data/projects.example.json` 作为种子数据初始化项目列表。

> 默认端口 8787 可用环境变量 `WORKBENCH_PORT` 修改，监听地址用 `WORKBENCH_HOST`（默认 `127.0.0.1`，不建议改成 `0.0.0.0` 对外开放）。

## 三种启动器与字段说明

| 字段 | script | docker | static |
|---|---|---|---|
| `path` | bat/cmd/exe 路径 | **compose 文件所在目录** | HTML 文件或目录 |
| `ports` | 状态探测 + 停止时定位进程 | 状态探测（compose ps 优先） | 不适用 |
| `urls` | 「打开」按钮目标（可多个） | 同左 | file:/// 或 http 地址 |
| `options.composeFile` | — | 默认 `docker-compose.yml` | — |
| `options.processMatch` | 按命令行关键字匹配进程（停止兜底，如 `daemon.mjs`） | — | — |
| `options.command` | 自定义启动命令（优先于 path） | — | — |
| `options.console` | `true` 时在新控制台窗口运行（等同双击；兼容"输出被重定向就解析错位"的特殊 bat，此时不捕获日志） | — | — |
| `options.cwd` / `options.env` / `options.encoding` | 工作目录 / 环境变量 / 输出编码（如 `gbk`） | — | — |

**停止策略（script 型）**：很多 bat 用 `start` 拉起服务后自己退出，进程树断裂无法直接跟踪。工作台按三层顺序停止：① 本次启动跟踪的 PID → `taskkill /T /F`；② 对 `ports` 里监听中的端口反查 PID 后结束；③ `options.processMatch` 按命令行匹配。三层都未命中时如实提示"进程未跟踪"，绝不误杀。

## 让 AI 同事接入

任何能发 HTTP 请求的 AI / 脚本，都可以把新项目注册进工作台：

```bash
curl -X POST "http://127.0.0.1:8787/api/v1/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "我的新 RAG 服务",
    "type": "script",
    "description": "FastAPI RAG 网关",
    "path": "D:/ai/my-rag/启动.bat",
    "ports": [8901],
    "urls": ["http://127.0.0.1:8901"],
    "tags": ["RAG"]
  }'
```

- 字段规范见 `GET /api/v1/schema/project`（自描述 JSON Schema）
- 完整接入文档（含 PowerShell / Python / Node 示例、upsert 幂等注册、启停调用）：**[docs/API.md](docs/API.md)**

## 扩展新启动器类型

在 `server/launchers/` 下新建文件，实现统一接口后注册即可：

```js
// server/launchers/my-type.js
module.exports = {
  capabilities: { canStart: true, canStop: true, canRestart: false, canOpen: true },
  async start(project)  { /* ... */ return { ok: true, message: '已启动' }; },
  async stop(project)   { return { ok: true, message: '已停止' }; },
  async restart(project) { /* ... */ },
  async getStatus(project) { return { status: 'running' }; }, // running/stopped/starting/unknown/idle
  openUrls: require('./base').openUrls,
};

// server/launchers/index.js 末尾追加
register('my-type', require('./my-type'));
```

前端卡片按钮按 `capabilities` 自动渲染，REST 校验按注册表自动生效，无需改前端。

## 项目结构

```
├─ server/
│  ├─ index.js            # Express 入口
│  ├─ config.js           # 端口 / 数据目录 / token（env 优先）
│  ├─ store.js            # projects.json 原子读写
│  ├─ validate.js         # 入参校验（含防命令注入）
│  ├─ procman.js          # 进程跟踪 + 日志环形缓冲
│  ├─ probe.js            # 端口探测 / netstat 反查 PID / 进程树结束
│  ├─ routes/             # CRUD 与动作路由
│  └─ launchers/          # ★ 可扩展启动器：script / docker / static
├─ public/                # 无构建前端（原生 HTML/CSS/JS）
├─ data/
│  ├─ projects.example.json   # 种子数据（入库）
│  └─ projects.json           # 实际数据（gitignore，首次运行自动生成）
├─ docs/API.md            # AI 同事接入文档
├─ scripts/启动工作台.bat
└─ test/                  # node:test 单元测试 + 启停全链路集成测试
```

## 测试

```bash
npm test
```

20 个用例：存储层、入参校验、端口探测、启动器注册表，以及最关键的**全链路集成测试**——用测试夹具 bat 模拟真实世界"`start` 拉起孙进程后立即退出"的场景，验证创建 → 启动 → 端口探测 → 停止（端口反查杀进程树）→ 删除的完整闭环。

## 已知限制

- 工作台启动**之前**由外部手动拉起的"无端口"进程（如 GUI 程序）无法被停止或识别状态（显示"未知"，可在卡片上手动标记，工作台自己启动的实例不受影响）
- bat 内部 `start` 拉起的子服务的 stdout 在各自窗口/日志文件里（如 SillyTavern 的 `startup.log`），工作台日志只捕获主脚本输出
- `options.processMatch` 按命令行匹配进程，关键字要足够独特，避免误杀同名进程
- **个别 bat 与"输出重定向"不兼容**：cmd 在重定向输出（管道/文件）时解析含 `chcp` + 中文注释的 bat 可能错位（双击运行正常，经工作台启动报 9009）。给这类项目设置 `options.console: true`（编辑弹窗勾选"在新控制台窗口运行"），等同双击效果；代价是工作台不捕获其日志

## License

[MIT](LICENSE)
