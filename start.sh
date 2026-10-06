#!/usr/bin/env bash
# YunGet 管理后台一键启动脚本
set -e
cd "$(dirname "$0")"
PORT="${1:-3000}"
if [ ! -d node_modules ]; then
  echo "首次运行：安装依赖..."
  npm install
fi
echo "启动 YunGet 管理后台，端口 $PORT ..."
PORT="$PORT" node src/server.js
