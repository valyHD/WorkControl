import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const assetsDirectory = join(process.cwd(), "dist", "assets");
const assets = readdirSync(assetsDirectory).map((name) => {
  const content = readFileSync(join(assetsDirectory, name));
  return { name, bytes: content.byteLength, gzipBytes: gzipSync(content).byteLength };
});

function sumGzip(predicate) {
  return assets.filter(predicate).reduce((total, asset) => total + asset.gzipBytes, 0);
}

function findGzip(prefix, extension = ".js") {
  return assets.find(
    (asset) => asset.name.startsWith(prefix) && asset.name.endsWith(extension)
  )?.gzipBytes || 0;
}

const checks = [
  {
    label: "application CSS",
    actual: sumGzip((asset) => asset.name.endsWith(".css") && !asset.name.startsWith("leaflet-")),
    maximum: 52 * 1024,
  },
  {
    label: "initial shell JavaScript",
    actual: sumGzip(
      (asset) =>
        asset.name.endsWith(".js") &&
        (asset.name.startsWith("index-") || asset.name.startsWith("chunk-"))
    ),
    maximum: 82 * 1024,
  },
  {
    label: "voice assistant chunk",
    actual: findGzip("VoiceCommandAssistant-"),
    maximum: 45 * 1024,
  },
  {
    label: "fleet GPS page chunk",
    actual: findGzip("VehicleGpsMapsPage-"),
    maximum: 10 * 1024,
  },
  {
    label: "Firebase vendor chunk",
    actual: findGzip("firebase-"),
    maximum: 190 * 1024,
  },
];

let failed = false;
for (const check of checks) {
  const ok = check.actual <= check.maximum;
  failed ||= !ok;
  const actualKb = (check.actual / 1024).toFixed(2);
  const maximumKb = (check.maximum / 1024).toFixed(2);
  console.log(`${ok ? "PASS" : "FAIL"} ${check.label}: ${actualKb} KB gzip / ${maximumKb} KB`);
}

if (failed) process.exitCode = 1;
