#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

git pull origin main
npm ci --omit=dev
pm2 restart ecosystem.config.cjs --update-env
pm2 save
