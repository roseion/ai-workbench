# AI 同事接入指南（REST API）

工作台提供一组本地 REST API。你在建完一个新项目后，只需一个 HTTP 请求就能把它注册进工作台，主人在网页上立刻能看到并一键启动。

- 基地址：`http://127.0.0.1:8787/api/v1`
- 所有请求/响应均为 UTF-8 JSON（**注意**：用 PowerShell 的 `Invoke-RestMethod` 或 Python `requests` 发中文没问题；用 curl 在部分终端可能引入 GBK 乱码，建议中文内容走文件：`curl -H "Content-Type: application/json" --data-binary @project.json ...`）
- 若工作台启用了 `WORKBENCH_TOKEN`，写操作需携带 `Authorization: Bearer <token>`

## 注册一个项目

```
POST /api/v1/projects            # 新建；id 冲突返回 409
POST /api/v1/projects?upsert=true  # 幂等：id 已存在则合并更新（只覆盖提交的字段）
```

最小请求体（script 类型）：

```json
{
  "name": "我的新 RAG 服务",
  "type": "script",
  "path": "D:/ai/my-rag/启动.bat",
  "ports": [8901],
  "urls": ["http://127.0.0.1:8901"]
}
```

字段速查（完整定义见 `GET /api/v1/schema/project`）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 项目名，≤100 字符 |
| `nameNote` | 可选 | 名字备注：显示在项目名下方的短备注（≤200 字符，卡片上可就地编辑） |
| `type` | ✅ | `script` / `docker` / `static`（以 `GET /api/v1/types` 为准） |
| `groupId` | 可选 | 所属分组 id（省略 = 未分组）。可先 `POST /api/v1/groups` 创建，或 `GET /api/v1/groups` 查询 |
| `path` | 类型相关 | script: bat/cmd/exe 路径；docker: compose 目录；static: HTML 路径。不能含引号/换行 |
| `ports` | 可选 | 端口数组（1–65535），用于状态探测与停止定位 |
| `urls` | 可选 | 「打开」目标，第一个为主地址；静态项目可用 `file:///` |
| `description` | 可选 | 一句话简介 |
| `dependencies` | 可选 | 依赖项（展示用），如 `["Ollama", "Node.js"]` |
| `tags` | 可选 | 标签 |
| `notes` | 可选 | 备注 |
| `options.command` | 可选 | script: 自定义启动命令（优先于 path） |
| `options.cwd` / `options.env` | 可选 | script: 工作目录 / 附加环境变量 |
| `options.processMatch` | 可选 | script: 按命令行关键字匹配进程（如 `"daemon.mjs"`）。停止兜底；无端口项目还用它判定运行状态——终端手动启动的实例也能被识别 |
| `options.composeFile` | 可选 | docker: compose 文件名，默认 `docker-compose.yml` |
| `options.encoding` | 可选 | script: 输出编码，如 `"gbk"` |
| `options.console` | 可选 | script: `true` 时在新控制台窗口运行（等同双击；兼容输出被重定向会解析错位的 bat），此时工作台不捕获日志 |
| `id` | 可选 | 唯一标识（`[a-zA-Z0-9._-]`），省略则按 name 自动生成 |

**类型前置条件**：`script` 需要 `path` 或 `options.command`；`docker` 需要 `path`（compose 目录）；`static` 需要 `path` 或至少一个 `urls`。

校验失败返回 `400`，`error.details` 数组逐条说明原因——按提示修正即可：

```json
{ "error": { "message": "校验失败", "details": ["script 类型需要提供 path 或 options.command"] } }
```

## 各语言一行注册示例

PowerShell（Windows 原生，推荐）：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/v1/projects" -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes('{"name":"我的新项目","type":"script","path":"D:/ai/new/启动.bat","ports":[8901],"urls":["http://127.0.0.1:8901"]}'))
```

Python：

```python
import requests
requests.post("http://127.0.0.1:8787/api/v1/projects", json={
    "name": "我的新项目", "type": "script",
    "path": r"D:\ai\new\启动.bat", "ports": [8901],
    "urls": ["http://127.0.0.1:8901"],
}).raise_for_status()
```

Node.js：

```js
await fetch("http://127.0.0.1:8787/api/v1/projects", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "我的新项目", type: "script", path: "D:/ai/new/启动.bat", ports: [8901] }),
});
```

## 生命周期动作

```
POST /api/v1/projects/:id/start     # 启动
POST /api/v1/projects/:id/stop      # 停止
POST /api/v1/projects/:id/restart   # 重启
POST /api/v1/projects/:id/open      # 打开浏览器
POST /api/v1/projects/:id/update    # docker: pull + up -d（仅 docker 型）
```

动作执行成功返回 `200` + `{ "ok": true, "message": "..." }`；无法执行（能力不支持/失败）返回 `4xx` + 错误消息。每个项目支持哪些动作看它的 `capabilities`（`canStart/canStop/canRestart/canOpen/canUpdate`）。

## 查询

```
GET  /api/v1/projects               # 列表（含实时 status 与 capabilities）
GET  /api/v1/projects/:id           # 单个项目
GET  /api/v1/projects/:id/status    # 状态：running / stopped / starting / unknown / idle
GET  /api/v1/projects/:id/logs      # 最近日志 { lines: [{ts, stream, text}] }
GET  /api/v1/health                 # 健康检查
GET  /api/v1/types                  # 已注册的启动器类型
GET  /api/v1/schema/project         # 项目 JSON Schema
```

## 编辑与删除

```
PATCH  /api/v1/projects/:id   # 部分更新，如 {"notes": "新备注"} 或 {"groupId": "xxx"}
PUT    /api/v1/projects/:id   # 全量更新
DELETE /api/v1/projects/:id   # 删除（仅移除记录，不动磁盘文件）
```

## 分组

```
GET    /api/v1/groups               # 分组列表（按 order 排序）
POST   /api/v1/groups               # 创建，如 {"name": "写作"}
PATCH  /api/v1/groups/:id           # 重命名 {"name": "..."} / 调整 {"order": 0}
POST   /api/v1/groups/reorder       # 拖拽排序，提交完整 id 顺序 {"ids": ["g1","g2"]}
DELETE /api/v1/groups/:id           # 解散分组，组内项目自动移回未分组
```

项目入组/出组用 `PATCH /api/v1/projects/:id` 提交 `{"groupId": "xxx"}`（null = 未分组）。

## 推荐流程（AI 同事视角）

1. 建好项目、确认本地能启动、确定端口和访问地址
2. `POST /api/v1/projects?upsert=true` 注册（幂等，重复调用安全）
3. （可选）`POST .../:id/start` 自检一次，再 `GET .../:id/status` 确认 `running`
4. 告诉主人："已注册进工作台，卡片上点启动即可"

## 完整示例：注册一个静态页面

```json
{
  "name": "数据看板",
  "type": "static",
  "description": "本地静态数据看板",
  "path": "D:/ai/dashboard/index.html",
  "urls": ["file:///D:/ai/dashboard/index.html"],
  "tags": ["看板"]
}
```

静态项目没有启停概念，卡片上只有「打开」按钮。
