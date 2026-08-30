'use strict';

// 后端 API 封装：统一错误处理，非 2xx 抛出后端返回的错误消息
async function req(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    throw new Error((data && data.error && data.error.message) || `${res.status} ${res.statusText}`);
  }
  return data;
}

const API = {
  health: () => req('GET', '/api/v1/health'),
  types: () => req('GET', '/api/v1/types'),
  list: () => req('GET', '/api/v1/projects'),
  get: (id) => req('GET', `/api/v1/projects/${encodeURIComponent(id)}`),
  create: (payload, upsert = false) => req('POST', `/api/v1/projects${upsert ? '?upsert=true' : ''}`, payload),
  patch: (id, payload) => req('PATCH', `/api/v1/projects/${encodeURIComponent(id)}`, payload),
  remove: (id) => req('DELETE', `/api/v1/projects/${encodeURIComponent(id)}`),
  action: (id, action) => req('POST', `/api/v1/projects/${encodeURIComponent(id)}/${action}`),
  mark: (id, status) => req('POST', `/api/v1/projects/${encodeURIComponent(id)}/mark`, { status }),
  status: (id) => req('GET', `/api/v1/projects/${encodeURIComponent(id)}/status`),
  logs: (id, lines = 300) => req('GET', `/api/v1/projects/${encodeURIComponent(id)}/logs?lines=${lines}`),
  // 分组
  groups: () => req('GET', '/api/v1/groups'),
  createGroup: (name) => req('POST', '/api/v1/groups', { name }),
  updateGroup: (id, patch) => req('PATCH', `/api/v1/groups/${encodeURIComponent(id)}`, patch),
  reorderGroups: (ids) => req('POST', '/api/v1/groups/reorder', { ids }),
  removeGroup: (id) => req('DELETE', `/api/v1/groups/${encodeURIComponent(id)}`),
};
