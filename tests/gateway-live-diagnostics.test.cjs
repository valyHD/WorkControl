const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const gatewaySource = fs.readFileSync(
  path.join(__dirname, "..", "index server de la gps pe server.cjs"),
  "utf8"
);

test("AVL 16 is documented as tracker virtual odometer, not OBD dashboard mileage", () => {
  assert.match(
    gatewaySource,
    /16:\s*\{[^}]*key:\s*"totalOdometerKm"[^}]*group:\s*"gps"[^}]*nu este kilometrajul din bord\/ECU"/
  );
});

test("calculated engine load alone does not generate unusual-event spam", () => {
  assert.doesNotMatch(gatewaySource, /makeDiagnosticEvent\(\s*"high_engine_load"/);
  assert.match(gatewaySource, /31:\s*\{[^}]*key:\s*"engineLoadPct"/);
});
