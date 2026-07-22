import assert from "node:assert/strict";
import test from "node:test";
import { GeoPoint, Timestamp } from "firebase-admin/firestore";
import {
  decodeFirestoreBackupValue,
  encodeFirestoreBackupValue,
} from "./firestore-backup-codec.mjs";

test("backup codec preserves Firestore and binary values recursively", () => {
  const source = {
    timestamp: new Timestamp(1_721_604_923, 123_000_000),
    point: new GeoPoint(44.4268, 26.1025),
    date: new Date("2026-07-22T06:30:00.000Z"),
    bytes: Buffer.from("WorkControl", "utf8"),
    nested: [{ timestamp: new Timestamp(42, 7) }],
    nullable: null,
  };

  const restored = decodeFirestoreBackupValue(
    JSON.parse(JSON.stringify(encodeFirestoreBackupValue(source)))
  );

  assert.ok(restored.timestamp instanceof Timestamp);
  assert.equal(restored.timestamp.seconds, source.timestamp.seconds);
  assert.equal(restored.timestamp.nanoseconds, source.timestamp.nanoseconds);
  assert.ok(restored.point instanceof GeoPoint);
  assert.equal(restored.point.latitude, source.point.latitude);
  assert.equal(restored.point.longitude, source.point.longitude);
  assert.ok(restored.date instanceof Date);
  assert.equal(restored.date.toISOString(), source.date.toISOString());
  assert.ok(Buffer.isBuffer(restored.bytes));
  assert.equal(restored.bytes.toString("utf8"), "WorkControl");
  assert.ok(restored.nested[0].timestamp instanceof Timestamp);
  assert.equal(restored.nullable, null);
});

test("backup codec omits undefined object fields without changing arrays", () => {
  const encoded = encodeFirestoreBackupValue({ keep: 1, omit: undefined, values: [1, undefined, 3] });

  assert.deepEqual(Object.keys(encoded).sort(), ["keep", "values"]);
  assert.equal(encoded.values.length, 3);
  assert.equal(encoded.values[1], undefined);
});
