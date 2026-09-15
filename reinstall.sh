#!/usr/bin/env bash

# 首次安装或需要重新建立 link 时使用；日常改代码不需要重复执行本脚本。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${SCRIPT_DIR}"

echo "[1/3] 安装依赖"
npm install

echo "[2/3] 构建 DSH Client"
npm run build:client

echo "[3/3] Link 到 DSH web profile"
dsh plugin --profile web add "link:${SCRIPT_DIR}"

echo "完成：请重启 DSH web profile。"
