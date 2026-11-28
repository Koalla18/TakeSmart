#!/bin/sh
set -eu

# Оба Dockerfile запускают миграции и API через один entrypoint.
cd "$(dirname "$0")"
exec python run.py
