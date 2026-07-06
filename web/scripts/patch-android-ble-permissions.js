import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(projectRoot, "android", "app", "src", "main", "AndroidManifest.xml");

const permissions = [
  '<uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />',
  '<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" tools:targetApi="s" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
];

if (!existsSync(manifestPath)) {
  console.warn("AndroidManifest.xml not found yet. Run `npm run android:add` after installing dependencies.");
  process.exit(0);
}

let manifest = readFileSync(manifestPath, "utf8");
if (!manifest.includes("xmlns:tools=")) {
  manifest = manifest.replace("<manifest ", '<manifest xmlns:tools="http://schemas.android.com/tools" ');
}

const missing = permissions.filter((permission) => {
  const nameMatch = permission.match(/android:name="([^"]+)"/);
  return !nameMatch || !manifest.includes(`android:name="${nameMatch[1]}"`);
});

if (missing.length === 0) {
  console.log("BLE permissions already present in AndroidManifest.xml");
  process.exit(0);
}

manifest = manifest.replace(/\n\s*<application\b/, `\n    ${missing.join("\n    ")}\n\n    <application`);
writeFileSync(manifestPath, manifest, "utf8");
console.log(`Added ${missing.length} BLE permission entries to AndroidManifest.xml`);