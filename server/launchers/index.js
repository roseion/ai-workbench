'use strict';

// 启动器注册表 —— 工作台的可扩展点。
// 新增类型：在 launchers/ 下新建文件，实现
//   { capabilities, start, stop, restart, getStatus, openUrls }
// 然后在这里 register('<type>', impl) 即可，前端按钮按 capabilities 自动渲染。

const registry = new Map();

function register(type, impl) {
  if (registry.has(type)) throw new Error(`启动器类型重复注册: ${type}`);
  registry.set(type, impl);
}

const get = (type) => registry.get(type) || null;
const types = () => [...registry.keys()];
const capabilities = (type) => {
  const l = get(type);
  return l ? { ...l.capabilities } : null;
};

register('script', require('./script'));
register('docker', require('./docker'));
register('static', require('./static'));

module.exports = { register, get, types, capabilities };
