/* eslint-disable */
// 临时：把 .credentials.yaml 从旧嵌套格式迁移到 rc.8 扁平格式（跑完即删）
const fs = require('fs');

const FILE = 'C:/Users/eosin/.dsh/.credentials.yaml';
const yaml = fs.readFileSync(FILE, 'utf8');

// 手工解析这个已知的 5 行小文件：refs 子节点即为凭证
const lines = yaml.split(/\r?\n/);
const entries = [];
let inRefs = false;
for (const l of lines) {
  if (/^refs:\s*$/.test(l)) { inRefs = true; continue; }
  if (inRefs) {
    const m = l.match(/^ {2}([^:\s]+):\s*(.+?)\s*$/);
    if (m) entries.push([m[1], m[2]]);
  }
}
if (!entries.length) { console.log('未解析到凭证，中止'); process.exit(1); }

fs.writeFileSync(FILE + '.bak.migrate', yaml, 'utf8');

// 单引号 YAML 安全输出：' → ''
const quote = (s) => "'" + s.replace(/'/g, "''") + "'";
const out = entries.map(([k, v]) => `${k}: ${quote(v)}`).join('\n') + '\n';
fs.writeFileSync(FILE, out, 'utf8');

console.log('迁移完成，顶层凭证键:', entries.map((e) => e[0]).join(', '));
console.log('备份: .credentials.yaml.bak.migrate');
