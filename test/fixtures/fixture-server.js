// 测试夹具：最小 HTTP 服务，供启动/停止链路测试使用（监听 8917）
require('http')
  .createServer((q, s) => s.end('workbench-fixture-ok'))
  .listen(8917, '127.0.0.1', () => console.log('fixture listening on 8917'));
