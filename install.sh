#!/bin/sh
# herdr-orchestrator's installer: puts the herdr-orchestrator layout, its mods and helpers into your Herdr app.
# ./install.sh [--root DIR] [--dry-run] [--guard] ...   (bin/herdr-orchestrator install --help for all)
# ./install.sh --web                                   web only: no herdr-app (the service, the web app, herdr-task)
# Run it again to update; `herdr-orchestrator uninstall` takes it all back out.
here=$(cd "$(dirname "$0")" && pwd -P)
command -v python3 >/dev/null 2>&1 || { echo "herdr-orchestrator needs python3 (3.8 or newer)." >&2; exit 1; }
exec python3 "$here/bin/herdr-orchestrator" install "$@"
