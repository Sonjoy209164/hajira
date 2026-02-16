#!/usr/bin/env bash
set -euo pipefail

DEST_REL="${1:-examples/tracking-init-demo}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_APP_TSX="$SCRIPT_DIR/templates/tracking-init-demo/App.tsx"
TEMPLATE_METRO_CONFIG="$SCRIPT_DIR/templates/tracking-init-demo/metro.config.js"
TEMPLATE_README="$SCRIPT_DIR/templates/tracking-init-demo/README.md"
TEMPLATE_EAS_JSON="$SCRIPT_DIR/templates/tracking-init-demo/eas.json"
TEMPLATE_BUILD_LOCAL_PACKAGES="$SCRIPT_DIR/templates/tracking-init-demo/scripts/build-local-packages.cjs"

DEST="$REPO_ROOT/$DEST_REL"

if [[ ! -f "$TEMPLATE_APP_TSX" ]]; then
  echo "Missing template: $TEMPLATE_APP_TSX" >&2
  exit 1
fi
if [[ ! -f "$TEMPLATE_METRO_CONFIG" ]]; then
  echo "Missing template: $TEMPLATE_METRO_CONFIG" >&2
  exit 1
fi
if [[ ! -f "$TEMPLATE_README" ]]; then
  echo "Missing template: $TEMPLATE_README" >&2
  exit 1
fi
if [[ ! -f "$TEMPLATE_EAS_JSON" ]]; then
  echo "Missing template: $TEMPLATE_EAS_JSON" >&2
  exit 1
fi
if [[ ! -f "$TEMPLATE_BUILD_LOCAL_PACKAGES" ]]; then
  echo "Missing template: $TEMPLATE_BUILD_LOCAL_PACKAGES" >&2
  exit 1
fi

if [[ -e "$DEST" ]]; then
  echo "Destination already exists: $DEST_REL" >&2
  echo "Pick a different path, e.g.: bash scripts/create-tracking-init-demo.sh examples/demo2" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"

echo "[1/4] Building local packages (so file: installs have dist/)"
(cd "$REPO_ROOT" && npm run build)

echo "[2/4] Creating Expo app: $DEST_REL"
if ! npx create-expo-app@latest "$DEST" --template blank-typescript; then
  echo "create-expo-app template flag failed; retrying without template (may prompt)..." >&2
  npx create-expo-app@latest "$DEST"
fi

cd "$DEST"

echo "[3/4] Installing deps"
# Install SDK peer deps using expo (picks compatible versions for the app's Expo SDK)
npx expo install expo-location expo-task-manager expo-constants
npx expo install @react-native-async-storage/async-storage @react-native-community/netinfo

# Install local workspace packages (no publish needed)
npm install "$REPO_ROOT/packages/tracking-init" "$REPO_ROOT/packages/tracking-core"

echo "[4/4] Writing demo App.tsx + patching app.json permissions"
echo "  - adding build scripts for local workspace packages"
node -e '
const fs = require("fs");
const pkgPath = "package.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.scripts = pkg.scripts || {};

pkg.scripts["build:local-packages"] = "node ./scripts/build-local-packages.cjs";
pkg.scripts.postinstall = "npm run build:local-packages";
pkg.scripts["eas-build-post-install"] = "npm run build:local-packages";

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\\n");
'

mkdir -p "$DEST/scripts"
cp "$TEMPLATE_BUILD_LOCAL_PACKAGES" "$DEST/scripts/build-local-packages.cjs"
cp "$TEMPLATE_APP_TSX" "$DEST/App.tsx"
cp "$TEMPLATE_METRO_CONFIG" "$DEST/metro.config.js"
cp "$TEMPLATE_README" "$DEST/README.md"
cp "$TEMPLATE_EAS_JSON" "$DEST/eas.json"

node -e '
const fs = require("fs");
const path = "app.json";
const raw = fs.readFileSync(path, "utf8");
const data = JSON.parse(raw);
data.expo = data.expo || {};

const slug = String(data.expo.slug || "trackinginitdemo")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "");
const appId = `com.hajiracm.${slug || "trackinginitdemo"}`;

// Android permissions for background tracking + FGS notification
data.expo.android = data.expo.android || {};
if (!data.expo.android.package) {
  data.expo.android.package = appId;
}
if (typeof data.expo.android.versionCode !== "number") {
  data.expo.android.versionCode = 1;
}
const perms = [
  "ACCESS_COARSE_LOCATION",
  "ACCESS_FINE_LOCATION",
  "ACCESS_BACKGROUND_LOCATION",
  "FOREGROUND_SERVICE",
  "FOREGROUND_SERVICE_LOCATION",
  "POST_NOTIFICATIONS",
];
const existingPerms = Array.isArray(data.expo.android.permissions) ? data.expo.android.permissions : [];
data.expo.android.permissions = Array.from(new Set([...existingPerms, ...perms]));

// iOS permission strings + background mode
data.expo.ios = data.expo.ios || {};
if (!data.expo.ios.bundleIdentifier) {
  data.expo.ios.bundleIdentifier = appId;
}
data.expo.ios.infoPlist = data.expo.ios.infoPlist || {};
if (!data.expo.ios.infoPlist.NSLocationWhenInUseUsageDescription) {
  data.expo.ios.infoPlist.NSLocationWhenInUseUsageDescription =
    "This app uses your location to demonstrate tracking.";
}
if (!data.expo.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription) {
  data.expo.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription =
    "This app uses your location in the background to demonstrate tracking.";
}
const bg = Array.isArray(data.expo.ios.infoPlist.UIBackgroundModes) ? data.expo.ios.infoPlist.UIBackgroundModes : [];
data.expo.ios.infoPlist.UIBackgroundModes = Array.from(new Set([...bg, "location"]));

// expo-location plugin permission prompts (safe to add if missing)
let plugins = data.expo.plugins;
if (!Array.isArray(plugins)) plugins = [];
const hasExpoLocation = plugins.some((p) => (Array.isArray(p) && p[0] === "expo-location") || p === "expo-location");
if (!hasExpoLocation) {
  plugins.push([
    "expo-location",
    {
      locationWhenInUsePermission: "Allow this app to access your location while you are using the app.",
      locationAlwaysAndWhenInUsePermission: "Allow this app to access your location even when the app is closed or not in use.",
    },
  ]);
}
data.expo.plugins = plugins;

fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
'

echo ""
echo "Done."
echo "Run:"
echo "  cd $DEST_REL"
echo "  npx expo start -c"
