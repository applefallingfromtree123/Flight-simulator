#!/bin/bash
# Downloads FlightGear aircraft and converts them for SkyLine (needs Node.js 20+ and git).
cd "$(dirname "$0")" && node tools/fgconv/convert.mjs "$@"
