#!/usr/bin/env bash
# 数据库直连小工具：从 .env.db 读连接串，跑 psql。
#
# 用法：
#   ./scripts/db.sh "select * from public.mastery limit 5"
#   ./scripts/db.sh                      # 进交互式 psql
#   ./scripts/db.sh -f supabase/schema.sql
#
# 连接串放在项目根目录的 .env.db（已被 .gitignore 忽略），格式：
#   DB_URL=postgresql://postgres.cntjupbrutxducbugjmt:密码@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
#
# ## 两个踩过的坑，别改回去
#
# 1. **必须走 pooler，不能用 Direct connection。**
#    Direct 的 `db.<ref>.supabase.co` 只解析 IPv6；在没有 IPv6 的机器上
#    直接 NXDOMAIN，看起来像「项目不存在」。pooler 走 IPv4，才连得上。
#    用 `aws-1-ap-south-1` 这一代：`aws-0` 对较新的项目会报 tenant not found。
#
# 2. **必须绕过系统代理。**
#    FlClash 之类把 7890 设成系统代理后，psql 会尝试走它，而代理不转发 5432，
#    现象是一律 `timeout expired`（不是认证失败，很有迷惑性）。curl 走 443 却是通的，
#    所以只看「网页能打开」会误判成网络正常。这里显式清掉代理变量。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.db"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 $ENV_FILE" >&2
  echo "在里面写一行：DB_URL=postgresql://..." >&2
  exit 1
fi

# 只取 DB_URL 这一行，source 整个文件会把别的变量也干掉
DB_URL="$(grep -E '^\s*DB_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"

if [[ -z "$DB_URL" ]]; then
  echo "$ENV_FILE 里没读到 DB_URL" >&2
  exit 1
fi

# 绕过系统代理（见文件头第 2 条）
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY 2>/dev/null || true

if [[ $# -eq 0 ]]; then
  exec psql "$DB_URL"
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 "$@"
