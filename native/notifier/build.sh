#!/bin/bash
# Builds Arete.app (the notifier) into native/notifier/build/. Needs Xcode's command line tools.
set -euo pipefail
cd "$(dirname "$0")"
APP=build/Arete.app
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Info.plist "$APP/Contents/Info.plist"
xcrun swiftc -O -o "$APP/Contents/MacOS/arete-notify" main.swift -framework AppKit -framework UserNotifications
# Icon: the app icon rendered at every size iconutil wants.
SET=build/AppIcon.iconset; rm -rf "$SET"; mkdir -p "$SET"
SRC=../../client/public/app-icon-1024.png
for s in 16 32 128 256 512; do
  sips -z $s $s "$SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$APP"
# Register with Launch Services so `open -a` and the Notifications settings find it.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
echo "Built $(pwd)/$APP"
