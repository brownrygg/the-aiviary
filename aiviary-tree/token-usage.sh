#!/bin/bash
# Wrapper script for easy token usage analytics access
cd "$(dirname "$0")/app" && ./scripts/token-usage.sh "$@"
