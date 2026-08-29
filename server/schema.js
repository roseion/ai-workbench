'use strict';

// 项目对象的 JSON Schema（自描述，供 AI 同事与客户端发现字段约定）
const SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'WorkbenchProject',
  description: 'AI 工作台项目条目。POST /api/v1/projects 按此结构提交即可注册新项目。',
  type: 'object',
  required: ['name', 'type'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$',
      description: '唯一标识，省略则根据 name 自动生成；POST ?upsert=true 时按 id 覆盖更新',
    },
    name: { type: 'string', maxLength: 100, description: '项目名（必填）' },
    type: {
      type: 'string',
      description: '启动器类型（必填）。可用值见 GET /api/v1/types，当前: script / docker / static，可通过插件扩展',
    },
    description: { type: 'string', maxLength: 500, description: '一句话简介' },
    path: {
      type: 'string',
      maxLength: 500,
      description: 'script: bat/cmd/程序路径；docker: compose 文件所在目录；static: HTML 文件或目录。不能包含引号或换行',
    },
    ports: {
      type: 'array', maxItems: 32,
      items: { type: 'integer', minimum: 1, maximum: 65535 },
      description: '服务端口列表，用于运行状态探测与停止时的进程定位',
    },
    urls: {
      type: 'array', maxItems: 10,
      items: { type: 'string', maxLength: 500 },
      description: '「打开」按钮的目标地址，第一个为主地址；静态项目可直接给 file:/// 地址',
    },
    dependencies: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 60 }, description: '依赖项（展示用）' },
    tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 30 }, description: '标签' },
    notes: { type: 'string', maxLength: 5000, description: '备注' },
    options: {
      type: 'object',
      additionalProperties: false,
      properties: {
        command: { type: 'string', maxLength: 1000, description: 'script: 自定义启动命令（默认用 path）' },
        cwd: { type: 'string', maxLength: 500, description: 'script: 工作目录（默认 path 所在目录）' },
        env: { type: 'object', description: 'script: 附加环境变量', additionalProperties: { type: 'string' } },
        processMatch: { type: 'string', maxLength: 200, description: 'script: 停止时按命令行关键字匹配进程（如 daemon.mjs）' },
        composeFile: { type: 'string', maxLength: 200, description: 'docker: compose 文件名（默认 docker-compose.yml）' },
        encoding: { type: 'string', maxLength: 50, description: 'script: 输出日志编码（如 gbk），默认 utf8' },
        console: { type: 'boolean', description: 'script: 在新控制台窗口运行（等同双击；兼容输出被重定向会解析错位的 bat），此时工作台不捕获日志' },
      },
    },
  },
};

module.exports = SCHEMA;
