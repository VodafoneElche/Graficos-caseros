#!/bin/sh
# Arranque en Mac/Linux: doble clic (Mac) o ./iniciar.command
cd "$(dirname "$0")"
OPEN_BROWSER=1 node --no-warnings server/server.mjs
