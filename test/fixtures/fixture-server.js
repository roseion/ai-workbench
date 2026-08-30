// 测试夹具：最小 HTTP 服务，供启动/停止链路测试使用。
// 端口由环境变量 FIXTURE_PORT 指定（测试运行时动态挑选，避开 Windows
// 每次开机漂移的保留端口段；缺省 8917 仅为手动运行兜底）
const port = Number(process.env.FIXTURE_PORT) || 8917;
require('http')
  .createServer((q, s) => s.end('workbench-fixture-ok'))
  .listen(port, '127.0.0.1', () => console.log(`fixture listening on ${port}`));
