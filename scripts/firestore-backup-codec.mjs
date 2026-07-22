import { GeoPoint, Timestamp } from "firebase-admin/firestore";

const TYPE_KEY = "__workcontrolFirestoreType";

export function encodeFirestoreBackupValue(value) {
  if (value instanceof Timestamp) {
    return { [TYPE_KEY]: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof GeoPoint) {
    return { [TYPE_KEY]: "geopoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (value instanceof Date) {
    return { [TYPE_KEY]: "date", value: value.toISOString() };
  }
  if (Buffer.isBuffer(value)) {
    return { [TYPE_KEY]: "buffer", value: value.toString("base64") };
  }
  if (Array.isArray(value)) return value.map(encodeFirestoreBackupValue);
  if (!value || typeof value !== "object") return value;
  return Object.entries(value).reduce((result, [key, item]) => {
    if (item !== undefined) result[key] = encodeFirestoreBackupValue(item);
    return result;
  }, {});
}

export function decodeFirestoreBackupValue(value) {
  if (Array.isArray(value)) return value.map(decodeFirestoreBackupValue);
  if (!value || typeof value !== "object") return value;
  if (value[TYPE_KEY] === "timestamp") {
    return new Timestamp(Number(value.seconds || 0), Number(value.nanoseconds || 0));
  }
  if (value[TYPE_KEY] === "geopoint") {
    return new GeoPoint(Number(value.latitude || 0), Number(value.longitude || 0));
  }
  if (value[TYPE_KEY] === "date") return new Date(String(value.value || ""));
  if (value[TYPE_KEY] === "buffer") return Buffer.from(String(value.value || ""), "base64");
  return Object.entries(value).reduce((result, [key, item]) => {
    result[key] = decodeFirestoreBackupValue(item);
    return result;
  }, {});
}
