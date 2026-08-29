'use strict';
const launchers = require('./launchers');

// 项目入参校验与归一化。
// path/command/cwd 等字段最终会进入 cmd 命令行，禁止引号与换行，防止参数注入。

const TOP_FIELDS = ['id', 'name', 'nameNote', 'type', 'description', 'path', 'ports', 'urls', 'dependencies', 'tags', 'notes', 'options'];
const OPTION_KEYS = ['command', 'cwd', 'env', 'processMatch', 'composeFile', 'encoding', 'console'];
const LIMITS = {
  name: 100, nameNote: 200, description: 500, notes: 5000, path: 500,
  command: 1000, cwd: 500, processMatch: 200, composeFile: 200, encoding: 50,
};

const str = (v) => (typeof v === 'string' ? v.trim() : undefined);
const hasCmdMeta = (s) => /[\r\n"]/.test(s);

function validateProjectInput(body, { partial = false } = {}) {
  const errs = [];
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  // 未知顶层字段直接拒绝，帮 AI 同事发现字段名拼写错误
  for (const key of Object.keys(body)) {
    if (!TOP_FIELDS.includes(key)) errs.push(`未知字段: ${key}（允许的字段: ${TOP_FIELDS.join(', ')}）`);
  }

  if (!partial || has('name')) {
    const name = str(body.name);
    if (!name) errs.push('name 必填');
    else if (name.length > LIMITS.name) errs.push(`name 最长 ${LIMITS.name} 字符`);
    else out.name = name;
  }

  if (!partial || has('type')) {
    const type = str(body.type);
    if (!type) errs.push('type 必填');
    else if (!launchers.types().includes(type)) errs.push(`type 必须是以下之一: ${launchers.types().join(' / ')}`);
    else out.type = type;
  }

  if (has('id') && body.id != null && body.id !== '') {
    const id = str(body.id);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) errs.push('id 只能包含字母、数字与 . _ -，且以字母或数字开头');
    else out.id = id;
  }

  const simpleStrings = ['nameNote', 'description', 'notes'];
  for (const f of simpleStrings) {
    if (!partial && !has(f)) { out[f] = ''; continue; }
    if (!has(f)) continue;
    const v = str(body[f]);
    if (v && v.length > LIMITS[f]) errs.push(`${f} 最长 ${LIMITS[f]} 字符`);
    else out[f] = v || '';
  }

  if (has('path') || !partial) {
    const p = str(body.path) || '';
    if (p) {
      if (p.length > LIMITS.path) errs.push(`path 最长 ${LIMITS.path} 字符`);
      if (hasCmdMeta(p)) errs.push('path 不能包含引号或换行');
      out.path = p;
    } else {
      out.path = '';
    }
  }

  if (has('ports') || !partial) {
    const raw = has('ports') ? body.ports : [];
    if (raw == null) { out.ports = []; }
    else if (!Array.isArray(raw)) errs.push('ports 必须是数组');
    else {
      const ports = [...new Set(raw.map((x) => Number(x)))];
      if (ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) errs.push('ports 必须是 1-65535 的整数');
      else if (ports.length > 32) errs.push('ports 最多 32 个');
      else out.ports = ports;
    }
  }

  if (has('urls') || !partial) {
    const raw = has('urls') ? body.urls : [];
    if (raw == null) { out.urls = []; }
    else if (!Array.isArray(raw)) errs.push('urls 必须是数组');
    else {
      const urls = raw.map((x) => String(x).trim()).filter(Boolean);
      if (urls.length > 10) errs.push('urls 最多 10 个');
      else if (urls.some((u) => /\s|"/.test(u) || u.length > 500)) errs.push('urls 单项不能含空白/引号，且最长 500 字符');
      else out.urls = urls;
    }
  }

  const strArrays = [['dependencies', 20, 60], ['tags', 20, 30]];
  for (const [f, max, maxLen] of strArrays) {
    if (has(f) || !partial) {
      const raw = has(f) ? body[f] : [];
      if (raw == null) { out[f] = []; continue; }
      if (!Array.isArray(raw)) { errs.push(`${f} 必须是数组`); continue; }
      const arr = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
      if (arr.length > max) errs.push(`${f} 最多 ${max} 项`);
      else if (arr.some((x) => x.length > maxLen)) errs.push(`${f} 单项最长 ${maxLen} 字符`);
      else out[f] = arr;
    }
  }

  if (has('options') || !partial) {
    const raw = has('options') ? body.options : {};
    if (raw == null) { out.options = {}; }
    else if (typeof raw !== 'object' || Array.isArray(raw)) errs.push('options 必须是对象');
    else {
      const opt = {};
      let ok = true;
      for (const key of Object.keys(raw)) {
        if (!OPTION_KEYS.includes(key)) {
          errs.push(`未知 options 字段: ${key}（允许: ${OPTION_KEYS.join(', ')}）`);
          ok = false;
          break;
        }
      }
      if (ok) {
        for (const key of OPTION_KEYS) {
          if (!(key in raw) || raw[key] == null) continue;
          if (key === 'env') {
            const env = raw[key];
            if (typeof env !== 'object' || Array.isArray(env)) { errs.push('options.env 必须是字符串键值对对象'); ok = false; break; }
            const entries = Object.entries(env);
            if (entries.length > 30) { errs.push('options.env 最多 30 项'); ok = false; break; }
            let envOk = true;
            const envOut = {};
            for (const [k, v] of entries) {
              if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || /[\r\n]/.test(String(v)) || String(v).length > 500) {
                errs.push(`options.env 键值不合法: ${k}`); envOk = false; break;
              }
              envOut[k] = String(v);
            }
            if (envOk) opt.env = envOut;
          } else if (key === 'console') {
            // 布尔选项：在新控制台窗口运行（兼容重定向输出会解析错位的 bat）
            if (typeof raw[key] === 'boolean') {
              if (raw[key]) opt.console = true;
            } else {
              errs.push('options.console 必须是布尔值');
              ok = false;
              break;
            }
          } else {
            const v = str(raw[key]) || '';
            if (v.length > LIMITS[key]) { errs.push(`options.${key} 最长 ${LIMITS[key]} 字符`); ok = false; break; }
            if (hasCmdMeta(v)) { errs.push(`options.${key} 不能包含引号或换行`); ok = false; break; }
            if (v) opt[key] = v;
          }
        }
        if (ok) out.options = opt;
      }
    }
  }

  // 类型相关的前置条件（新建/全量时校验）
  if (!partial) {
    const t = out.type;
    const pathGiven = !!out.path;
    const commandGiven = !!(out.options && out.options.command);
    const urlsGiven = !!(out.urls && out.urls.length);
    if (t === 'script' && !pathGiven && !commandGiven) errs.push('script 类型需要提供 path 或 options.command');
    if (t === 'docker' && !pathGiven) errs.push('docker 类型需要提供 path（compose 文件所在目录）');
    if (t === 'static' && !pathGiven && !urlsGiven) errs.push('static 类型需要提供 path 或至少一个 url');
  }

  return { ok: errs.length === 0, errors: errs, value: out };
}

module.exports = { validateProjectInput };
