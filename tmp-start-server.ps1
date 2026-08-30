$ErrorActionPreference = 'Stop'
$root = 'D:\ai\zcode\AI工作台项目'
$out = Join-Path $root 'data\logs\server.out.log'
$err = Join-Path $root 'data\logs\server.err.log'
Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
'started'
