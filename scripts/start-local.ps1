$root = Split-Path $PSScriptRoot -Parent
$redisDir = Join-Path $root ".tools\redis"
$mariaBin = Join-Path $root ".tools\mariadb-11.4.5-winx64\bin"
$dataDir = Join-Path $root ".tools\mariadb-data"

if (-not (Test-Path (Join-Path $redisDir "redis-server.exe"))) {
  Write-Error "缺少 .tools\redis。先按 README 准备本机 Redis。"
  exit 1
}
if (-not (Test-Path (Join-Path $mariaBin "mysqld.exe"))) {
  Write-Error "缺少 .tools\mariadb-11.4.5-winx64。先按 README 准备本机数据库。"
  exit 1
}

$pong = & (Join-Path $redisDir "redis-cli.exe") ping 2>$null
if ($pong -ne "PONG") {
  Start-Process -FilePath (Join-Path $redisDir "redis-server.exe") -ArgumentList (Join-Path $redisDir "local.conf") -WindowStyle Hidden
  Write-Host "Redis 已启动"
} else {
  Write-Host "Redis 已在运行"
}

& (Join-Path $mariaBin "mysqladmin.exe") --protocol=tcp -h 127.0.0.1 -P 3306 -u root ping 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Start-Process -FilePath (Join-Path $mariaBin "mysqld.exe") -ArgumentList "--datadir=$dataDir","--port=3306","--bind-address=127.0.0.1" -WindowStyle Hidden
  Write-Host "MariaDB 已启动"
} else {
  Write-Host "MariaDB 已在运行"
}
