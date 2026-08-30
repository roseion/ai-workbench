/* eslint-disable */
// 临时：打印凭证文件结构（键名可见、值打码）（跑完即删）
const fs = require('fs');

const lines = fs.readFileSync('C:/Users/eosin/.dsh/.credentials.yaml', 'utf8').split(/\r?\n/);
console.log('文件共 ' + lines.length + ' 行，结构如下（值已打码）：');
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.trim() === '') { console.log(`第${i + 1}行 (空行)`); continue; }
  const indent = l.match(/^\s*/)[0].length;
  const kv = l.trim().split(/:(.*)$/);
  const key = kv[0];
  const val = (kv[1] || '').trim();
  const masked = val === '' ? '(子节点)' : `<长度${val.length}>`;
  console.log(`第${i + 1}行 缩进${indent} 键="${key}" 值=${masked}`);
}
