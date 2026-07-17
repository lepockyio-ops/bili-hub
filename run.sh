#!/bin/bash
# BiliHub 启动脚本（Linux / macOS）

set -e
cd "$(dirname "$0")"

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "❌ 未找到 python3。请先安装 Python 3.10+"
    exit 1
fi

# 检查依赖
if ! python3 -c "import flask, yaml" 2>/dev/null; then
    echo "首次运行，正在安装依赖..."
    python3 -m pip install -r requirements.txt --quiet
fi

# 检查邻居目录
parent="$(cd .. && pwd)"
for name in biliwatch biliradar bili-comments; do
    if [ ! -d "$parent/$name" ]; then
        echo "⚠️  缺少邻居目录: $name（部分功能会失效）"
    fi
done

echo
python3 app.py
