'use strict';

// Express 异步路由包装：把 Promise 异常交给错误中间件
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tail(str, n = 400) {
  const s = String(str || '').trim();
  return s.length <= n ? s : '…' + s.slice(-n);
}

module.exports = { asyncH, now, sleep, tail };
