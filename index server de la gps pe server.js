require("dotenv").config();

const fs = require("fs");
const net = require("net");
const admin = require("firebase-admin");
const { exec } = require("child_process");
const util = require("util");

const execAsync = util.promisify(exec);

const serviceAccount = JSON.parse(
  fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const PORT = Number(process.env.TCP_PORT || 5001);

const activeDevices = new Map();
const healthyLoggedImei = new Set();
const pendingCodec12ByImei = new Map();
const COMMAND_RESPONSE_TIMEOUT_MS = 15000;
const MAX_BUFFER_BYTES = 1024 * 1024;
const SOCKET_IDLE_TIMEOUT_MS = 120000;

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CLEANUP_FILE = "/tmp/workcontrol-last-cleanup.txt";
function isCodec12SuccessPayload(payload) {
  const text = String(payload || "").toLowerCase();

  if (!text.trim()) return false;
  if (text.includes("error")) return false;
  if (text.includes("invalid")) return false;
  if (text.includes("failed")) return false;
  if (text.includes("unknown")) return false;
  if (text.includes("bad syntax")) return false;

  return true;
}
function bytesToUnsignedBigInt(buffer) {
  let value = 0n;
  for (const byte of buffer) {
    value = (value << 8n) + BigInt(byte);
  }
  return value;
}
function clearPendingCommandForImei(imei, reason) {
  if (!imei) return;

  const pending = pendingCodec12ByImei.get(imei);
  if (!pending) return;

  pendingCodec12ByImei.delete(imei);
  if (pending.timeout) {
    clearTimeout(pending.timeout);
  }

  void db
    .collection("vehicles")
    .doc(pending.vehicleId)
    .collection("commands")
    .doc(pending.commandId)
    .update({
      status: "failed",
      result: "failed",
      providerMessage: reason || `Conexiunea TCP cu ${imei} s-a inchis`,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .catch((error) => {
      console.error("[PENDING COMMAND CLEAR ERROR]", error);
    });
}
function decodeIoValue(buffer) {
  if (!buffer || buffer.length === 0) return null;
  if (buffer.length <= 6) return Number(bytesToUnsignedBigInt(buffer));
  return buffer.toString("hex");
}

function isValidImei(value) {
  return typeof value === "string" && /^\d{15}$/.test(value.trim());
}

function safeRemote(socket) {
  return `${socket.remoteAddress || "unknown"}:${socket.remotePort || "?"}`;
}

function clearActiveDeviceIfMatches(imei, socket) {
  if (!imei) return;

  const current = activeDevices.get(imei);
  if (!current) return;

  if (current.socket === socket) {
    activeDevices.delete(imei);
    healthyLoggedImei.delete(imei);
    clearPendingCommandForImei(imei, `Dispozitivul ${imei} s-a deconectat`);
    console.log(`[TCP DISCONNECTED] imei=${imei}`);
  }
}

function crc16IBM(buffer) {
  let crc = 0x0000;

  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ 0xa001;
      } else {
        crc >>= 1;
      }
    }
  }

  return crc & 0xffff;
}

function buildCodec12Command(commandText) {
  const commandBytes = Buffer.from(commandText, "ascii");
  const dataSize = 1 + 1 + 1 + 4 + commandBytes.length + 1;
  const packet = Buffer.alloc(4 + 4 + dataSize + 4);

  let offset = 0;

  packet.writeUInt32BE(0, offset);
  offset += 4;

  packet.writeUInt32BE(dataSize, offset);
  offset += 4;

  packet.writeUInt8(0x0c, offset);
  offset += 1;

  packet.writeUInt8(0x01, offset);
  offset += 1;

  packet.writeUInt8(0x05, offset);
  offset += 1;

  packet.writeUInt32BE(commandBytes.length, offset);
  offset += 4;

  commandBytes.copy(packet, offset);
  offset += commandBytes.length;

  packet.writeUInt8(0x01, offset);
  offset += 1;

  const crcSource = packet.subarray(8, offset);
  const crc = crc16IBM(crcSource);

  packet.writeUInt32BE(crc, offset);
  offset += 4;

  return packet;
}

function parseCodec12Packet(frame) {
  if (frame.length < 17) {
    throw new Error("Codec12 frame prea scurt");
  }

  const preamble = frame.readUInt32BE(0);
  if (preamble !== 0) {
    throw new Error("Codec12 preamble invalid");
  }

  const dataLength = frame.readUInt32BE(4);
  const totalLength = 8 + dataLength + 4;

  if (frame.length < totalLength) {
    throw new Error("Codec12 frame incomplet");
  }

  let offset = 8;

  const codecId = frame.readUInt8(offset);
  offset += 1;

  if (codecId !== 0x0c) {
    throw new Error(`Codec12 invalid: 0x${codecId.toString(16)}`);
  }

  const quantity1 = frame.readUInt8(offset);
  offset += 1;

  const type = frame.readUInt8(offset);
  offset += 1;

  const payloadSize = frame.readUInt32BE(offset);
  offset += 4;

  const payload = frame.subarray(offset, offset + payloadSize).toString("ascii");
  offset += payloadSize;

  const quantity2 = frame.readUInt8(offset);
  offset += 1;

  const crc = frame.readUInt32BE(offset);
  offset += 4;

  return {
    totalLength,
    dataLength,
    codecId,
    quantity1,
    quantity2,
    type,
    payloadSize,
    payload,
    crc,
  };
}

function parseCodec8ERecord(buffer, startOffset) {
  let offset = startOffset;

  const gpsTimestamp = Number(buffer.readBigUInt64BE(offset));
  offset += 8;

  const priority = buffer.readUInt8(offset);
  offset += 1;

  const lng = buffer.readInt32BE(offset) / 10000000;
  offset += 4;

  const lat = buffer.readInt32BE(offset) / 10000000;
  offset += 4;

  const altitude = buffer.readUInt16BE(offset);
  offset += 2;

  const angle = buffer.readUInt16BE(offset);
  offset += 2;

  const satellites = buffer.readUInt8(offset);
  offset += 1;

  const speedKmh = buffer.readUInt16BE(offset);
  offset += 2;

  const eventIoId = buffer.readUInt16BE(offset);
  offset += 2;

  const totalIo = buffer.readUInt16BE(offset);
  offset += 2;

  const io = {};

  const n1 = buffer.readUInt16BE(offset);
  offset += 2;
  for (let i = 0; i < n1; i++) {
    const id = buffer.readUInt16BE(offset);
    offset += 2;
    io[id] = decodeIoValue(buffer.subarray(offset, offset + 1));
    offset += 1;
  }

  const n2 = buffer.readUInt16BE(offset);
  offset += 2;
  for (let i = 0; i < n2; i++) {
    const id = buffer.readUInt16BE(offset);
    offset += 2;
    io[id] = decodeIoValue(buffer.subarray(offset, offset + 2));
    offset += 2;
  }

  const n4 = buffer.readUInt16BE(offset);
  offset += 2;
  for (let i = 0; i < n4; i++) {
    const id = buffer.readUInt16BE(offset);
    offset += 2;
    io[id] = decodeIoValue(buffer.subarray(offset, offset + 4));
    offset += 4;
  }

  const n8 = buffer.readUInt16BE(offset);
  offset += 2;
  for (let i = 0; i < n8; i++) {
    const id = buffer.readUInt16BE(offset);
    offset += 2;
    io[id] = decodeIoValue(buffer.subarray(offset, offset + 8));
    offset += 8;
  }

  const nx = buffer.readUInt16BE(offset);
  offset += 2;
  for (let i = 0; i < nx; i++) {
    const id = buffer.readUInt16BE(offset);
    offset += 2;

    const len = buffer.readUInt16BE(offset);
    offset += 2;

    io[id] = decodeIoValue(buffer.subarray(offset, offset + len));
    offset += len;
  }

  return {
    nextOffset: offset,
    record: {
      gpsTimestamp,
      priority,
      lat,
      lng,
      altitude,
      angle,
      satellites,
      speedKmh,
      eventIoId,
      totalIo,
      io,
    },
  };
}
async function claimCommandIfRequested(commandRef) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(commandRef);
    if (!snap.exists) {
      return null;
    }

    const data = snap.data() || {};
    if (data.status !== "requested") {
      return null;
    }

    tx.update(commandRef, {
      status: "pending",
      result: "sending",
      providerMessage: "Comanda preluata de gateway.",
      pickedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return data;
  });
}
function parseTcpAvlPacket(frame) {
  if (frame.length < 12) {
    throw new Error("Frame prea scurt");
  }

  const preamble = frame.readUInt32BE(0);
  if (preamble !== 0) {
    throw new Error("Preamble invalid");
  }

  const dataLength = frame.readUInt32BE(4);
  const totalLength = 8 + dataLength + 4;

  if (frame.length < totalLength) {
    throw new Error("Frame incomplet");
  }

  const codecId = frame.readUInt8(8);
  const recordCount = frame.readUInt8(9);

  if (codecId !== 0x8e) {
    throw new Error(`Codec nesuportat acum: 0x${codecId.toString(16)}`);
  }

  let offset = 10;
  const records = [];

  for (let i = 0; i < recordCount; i++) {
    const parsed = parseCodec8ERecord(frame, offset);
    records.push(parsed.record);
    offset = parsed.nextOffset;
  }

  const recordCount2 = frame.readUInt8(offset);
  offset += 1;

  if (recordCount !== recordCount2) {
    throw new Error("recordCount1 != recordCount2");
  }

  const crc = frame.readUInt32BE(offset);
  offset += 4;

  return {
    totalLength,
    dataLength,
    codecId,
    recordCount,
    crc,
    records,
  };
}

function isValidGpsRecord(record) {
  return (
    typeof record.lat === "number" &&
    typeof record.lng === "number" &&
    Number.isFinite(record.lat) &&
    Number.isFinite(record.lng) &&
    Math.abs(record.lat) <= 90 &&
    Math.abs(record.lng) <= 180 &&
    !(record.lat === 0 && record.lng === 0)
  );
}

function getDayKeyFromTs(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildPointId(record) {
  const latPart = Math.round(record.lat * 100000);
  const lngPart = Math.round(record.lng * 100000);
  return `${record.gpsTimestamp}_${latPart}_${lngPart}`;
}

function getLastCleanupTs() {
  try {
    if (!fs.existsSync(LAST_CLEANUP_FILE)) return 0;
    const raw = fs.readFileSync(LAST_CLEANUP_FILE, "utf8").trim();
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function setLastCleanupTs(ts) {
  try {
    fs.writeFileSync(LAST_CLEANUP_FILE, String(ts));
  } catch (error) {
    console.error("[CLEANUP WRITE ERROR]", error);
  }
}

async function runCommandSafe(command) {
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stdout && stdout.trim()) {
      console.log(`[CLEANUP CMD OK] ${command}`);
    }
    if (stderr && stderr.trim()) {
      console.warn(`[CLEANUP CMD STDERR] ${command} -> ${stderr.trim()}`);
    }
  } catch (error) {
    console.error(`[CLEANUP CMD ERROR] ${command}`, error);
  }
}

async function runServerCleanup() {
  console.log("[CLEANUP START] incepe curatarea automata");

  await runCommandSafe("pm2 flush");
  await runCommandSafe("journalctl --vacuum-time=7d");
  await runCommandSafe("apt clean");
  await runCommandSafe("apt autoclean");
  await runCommandSafe("apt autoremove -y");
  await runCommandSafe("find /var/log -type f -name '*.gz' -mtime +7 -delete");

  setLastCleanupTs(Date.now());

  console.log("[CLEANUP DONE] curatarea automata s-a terminat");
}

async function maybeRunServerCleanup() {
  const now = Date.now();
  const lastCleanup = getLastCleanupTs();

  if (now - lastCleanup < CLEANUP_INTERVAL_MS) {
    return;
  }

  await runServerCleanup();
}

function startCleanupScheduler() {
  void maybeRunServerCleanup();

  setInterval(() => {
    void maybeRunServerCleanup();
  }, 60 * 60 * 1000);
}

async function saveRecordsToFirestore(imei, records) {
  const bindingRef = db.collection("trackerBindings").doc(imei);
  const bindingSnap = await bindingRef.get();

  if (!bindingSnap.exists) {
    console.warn(`[WARN] IMEI fara binding: ${imei}`);
    await db.collection("unboundTrackerPackets").add({
      imei,
      recordsCount: records.length,
      createdAt: Date.now(),
      sample: records[0] || null,
    });
    return;
  }

  const binding = bindingSnap.data();
  const vehicleId = binding.vehicleId;
  const now = Date.now();

  const validRecords = records
    .filter(isValidGpsRecord)
    .sort((a, b) => a.gpsTimestamp - b.gpsTimestamp);

  if (!validRecords.length) {
    console.warn(`[WARN] imei=${imei} batch fara coordonate GPS valide`);
    return;
  }

  let latestSnapshot = null;
  const groups = new Map();

  for (const record of validRecords) {
    const dayKey = getDayKeyFromTs(record.gpsTimestamp);
    if (!groups.has(dayKey)) groups.set(dayKey, []);
    groups.get(dayKey).push(record);

    const odometerMeters =
      typeof record.io[16] === "number" ? record.io[16] : null;

    const ignitionOn =
      typeof record.io[239] === "number" ? record.io[239] === 1 : null;

    latestSnapshot = {
      lat: record.lat,
      lng: record.lng,
      speedKmh: record.speedKmh,
      gpsTimestamp: record.gpsTimestamp,
      serverTimestamp: now,
      ignitionOn,
      odometerKm:
        odometerMeters !== null
          ? Number((odometerMeters / 1000).toFixed(1))
          : null,
      imei,
      online: true,
      satellites: record.satellites,
      altitude: record.altitude,
      angle: record.angle,
    };
  }

  for (const [dayKey, dayRecords] of groups.entries()) {
    const dayRef = db
      .collection("vehicles")
      .doc(vehicleId)
      .collection("positionDays")
      .doc(dayKey);

    const dayChunks = chunkArray(dayRecords, 400);

    for (const dayChunk of dayChunks) {
      const batch = db.batch();

      batch.set(
        dayRef,
        {
          vehicleId,
          imei,
          dayKey,
          updatedAt: now,
          updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      for (const record of dayChunk) {
        const odometerMeters =
          typeof record.io[16] === "number" ? record.io[16] : null;

        const ignitionOn =
          typeof record.io[239] === "number" ? record.io[239] === 1 : null;

        const pointRef = dayRef.collection("points").doc(buildPointId(record));
const flatPositionRef = db
  .collection("vehicles")
  .doc(vehicleId)
  .collection("positions")
  .doc(buildPointId(record));
        batch.set(
          pointRef,
          {
            imei,
            vehicleId,
            dayKey,
            lat: record.lat,
            lng: record.lng,
            speedKmh: record.speedKmh,
            altitude: record.altitude,
            angle: record.angle,
            satellites: record.satellites,
            gpsTimestamp: record.gpsTimestamp,
            serverTimestamp: now,
            eventIoId: record.eventIoId,
            ignitionOn,
            odometerKm:
              odometerMeters !== null
                ? Number((odometerMeters / 1000).toFixed(1))
                : null,
            rawIo: record.io,
          },
          { merge: true }
        );
        batch.set(
  flatPositionRef,
  {
    imei,
    vehicleId,
    dayKey,
    lat: record.lat,
    lng: record.lng,
    speedKmh: record.speedKmh,
    altitude: record.altitude,
    angle: record.angle,
    satellites: record.satellites,
    gpsTimestamp: record.gpsTimestamp,
    serverTimestamp: now,
    eventIoId: record.eventIoId,
    ignitionOn,
    odometerKm:
      odometerMeters !== null
        ? Number((odometerMeters / 1000).toFixed(1))
        : null,
    rawIo: record.io,
  },
  { merge: true }
);
      }

      await batch.commit();
    }
  }

  if (latestSnapshot) {
    await db.collection("vehicles").doc(vehicleId).set(
      {
        gpsSnapshot: latestSnapshot,
        tracker: {
          imei,
          lastSeenAt: now,
          updatedAt: now,
          protocol: "teltonika_codec_8e_tcp",
        },
        updatedAt: now,
      },
      { merge: true }
    );
  }

  if (!healthyLoggedImei.has(imei)) {
    healthyLoggedImei.add(imei);
    console.log(
      `[TRACKER OK] imei=${imei} vehicleId=${vehicleId} recordsSaved=${validRecords.length}`
    );
  }
}

function sendCodec12CommandToDevice(imei, commandText, meta) {
  const entry = activeDevices.get(imei);

  if (!entry || !entry.socket || entry.socket.destroyed) {
    throw new Error(`Dispozitivul ${imei} nu are conexiune TCP activa`);
  }

  const packet = buildCodec12Command(commandText);

  if (meta?.vehicleId && meta?.commandId) {
    const existing = pendingCodec12ByImei.get(imei);
    if (existing?.timeout) {
      clearTimeout(existing.timeout);
    }

    const timeout = setTimeout(async () => {
      const pending = pendingCodec12ByImei.get(imei);
      if (!pending) return;

      pendingCodec12ByImei.delete(imei);

      try {
        await db
          .collection("vehicles")
          .doc(pending.vehicleId)
          .collection("commands")
          .doc(pending.commandId)
          .update({
            status: "failed",
            result: "failed",
            providerMessage: `Timeout asteptand raspuns Codec12 de la ${imei}`,
            completedAt: Date.now(),
            updatedAt: Date.now(),
          });
      } catch (error) {
        console.error("[COMMAND TIMEOUT UPDATE ERROR]", error);
      }
    }, COMMAND_RESPONSE_TIMEOUT_MS);

    pendingCodec12ByImei.set(imei, {
      vehicleId: meta.vehicleId,
      commandId: meta.commandId,
      commandText,
      timeout,
      requestedAt: Date.now(),
    });
  }

  entry.socket.write(packet, (err) => {
    if (err) {
      console.error(`[CMD WRITE ERROR] imei=${imei} command="${commandText}"`, err);
      return;
    }

    console.log(
      `[CMD SENT] imei=${imei} command="${commandText}" hex=${packet.toString("hex")}`
    );
  });

  activeDevices.set(imei, {
    socket: entry.socket,
    lastSeenAt: Date.now(),
  });
}
function mapCommandToTeltonika(commandDoc) {
  const durationSec =
    typeof commandDoc?.durationSec === "number" && commandDoc.durationSec > 0
      ? Math.max(1, Math.min(600, Math.round(commandDoc.durationSec)))
      : 60;

  if (commandDoc.type === "pulse_dout1") {
    return `setdigout 1? ${durationSec}`;
  }

  if (commandDoc.type === "block_start") {
    return "setdigout 0? 0";
  }

  if (commandDoc.type === "allow_start") {
    return "setdigout 1? 0";
  }

  throw new Error(`Tip comanda necunoscut: ${commandDoc.type}`);
}
async function processVehicleCommand(vehicleId, commandId, commandDoc) {
  const commandRef = db
    .collection("vehicles")
    .doc(vehicleId)
    .collection("commands")
    .doc(commandId);

  try {
    const vehicleSnap = await db.collection("vehicles").doc(vehicleId).get();
    if (!vehicleSnap.exists) {
      throw new Error("Vehicle not found");
    }

    const vehicle = vehicleSnap.data() || {};
    const imei = vehicle?.tracker?.imei;

    if (!imei) {
      throw new Error("IMEI lipsa in vehicles/{vehicleId}.tracker.imei");
    }

    const entry = activeDevices.get(imei);
    if (!entry || !entry.socket || entry.socket.destroyed) {
      await commandRef.update({
        status: "failed",
        result: "failed",
        providerMessage: `Dispozitivul ${imei} nu are conexiune TCP activa`,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return;
    }

    const teltonikaCommand = mapCommandToTeltonika(commandDoc);

    console.log(
      `[COMMAND QUEUED] vehicleId=${vehicleId} commandId=${commandId} imei=${imei} teltonika="${teltonikaCommand}"`
    );

await commandRef.update({
  status: "pending",
  result: "sending",
  providerMessage: `Se trimite catre ${imei}: ${teltonikaCommand}`,
  sentCommand: teltonikaCommand,
  updatedAt: Date.now(),
});

sendCodec12CommandToDevice(imei, teltonikaCommand, {
  vehicleId,
  commandId,
});
  } catch (error) {
    console.error(
      `[COMMAND ERROR] vehicleId=${vehicleId} commandId=${commandId}`,
      error
    );

    await commandRef.update({
      status: "failed",
      result: "failed",
      providerMessage: error instanceof Error ? error.message : String(error),
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}
function watchVehicleCommands() {
  const serverStartedAt = Date.now();

  db.collectionGroup("commands")
    .where("status", "==", "requested")
    .onSnapshot(
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type !== "added") return;

          const docSnap = change.doc;
          const data = docSnap.data() || {};
          const vehicleRef = docSnap.ref.parent.parent;

          if (!vehicleRef) return;

          const requestedAt =
            typeof data.requestedAt === "number" ? data.requestedAt : 0;

          // ignoram comenzile vechi la pornirea serverului
          if (requestedAt && requestedAt < serverStartedAt - 5000) {
            console.log(
              `[COMMAND SKIPPED OLD] vehicleId=${vehicleRef.id} commandId=${docSnap.id} requestedAt=${requestedAt}`
            );
            return;
          }

          void (async () => {
            try {
              const claimed = await claimCommandIfRequested(docSnap.ref);
              if (!claimed) {
                return;
              }

              await processVehicleCommand(vehicleRef.id, docSnap.id, claimed);
            } catch (err) {
              console.error("[COMMAND PROCESS ERROR]", err);
            }
          })();
        });
      },
      (error) => {
        console.error("[COMMAND WATCH ERROR]", error);
      }
    );
}

const server = net.createServer((socket) => {
  const remote = safeRemote(socket);

  console.log(`[TCP CONNECTED] ${remote}`);

  socket.setTimeout(SOCKET_IDLE_TIMEOUT_MS);

  const session = {
    stage: "imei",
    imei: null,
    buffer: Buffer.alloc(0),
  };

  socket.on("timeout", () => {
    console.warn(`[SOCKET TIMEOUT] ${remote}`);
    socket.destroy();
  });

  socket.on("data", (chunk) => {
    try {
      session.buffer = Buffer.concat([session.buffer, chunk]);

      if (session.buffer.length > MAX_BUFFER_BYTES) {
        console.warn(`[BUFFER OVERFLOW] ${remote} bytes=${session.buffer.length}`);
        socket.destroy();
        return;
      }

      while (session.buffer.length > 0) {
        if (session.stage === "imei") {
          if (session.buffer.length < 2) return;

          const imeiLength = session.buffer.readUInt16BE(0);

          if (imeiLength <= 0 || imeiLength > 32) {
            const sampleHex = session.buffer
              .subarray(0, Math.min(16, session.buffer.length))
              .toString("hex");
            console.warn(
              `[INVALID IMEI LENGTH] ${remote} imeiLength=${imeiLength} sample=${sampleHex}`
            );
            socket.destroy();
            return;
          }

          if (session.buffer.length < 2 + imeiLength) return;

          const rawImei = session.buffer
            .subarray(2, 2 + imeiLength)
            .toString("ascii")
            .trim();

          if (!isValidImei(rawImei)) {
            console.warn(`[INVALID IMEI] ${remote} value="${rawImei}"`);
            socket.destroy();
            return;
          }

          const imei = rawImei;

          session.imei = imei;
          activeDevices.set(imei, {
            socket,
            lastSeenAt: Date.now(),
          });

          session.buffer = session.buffer.subarray(2 + imeiLength);
          session.stage = "avl";

          console.log(`[IMEI ACCEPTED] imei=${imei} remote=${remote}`);
          socket.write(Buffer.from([0x01]));
          continue;
        }

        if (session.stage === "avl") {
          if (session.buffer.length < 12) return;

          const preamble = session.buffer.readUInt32BE(0);
          if (preamble !== 0) {
            const sampleHex = session.buffer
              .subarray(0, Math.min(24, session.buffer.length))
              .toString("hex");

            console.warn(
              `[INVALID PREAMBLE] imei=${session.imei} remote=${remote} sample=${sampleHex}`
            );
            socket.destroy();
            return;
          }

          const dataLength = session.buffer.readUInt32BE(4);
          const totalLength = 8 + dataLength + 4;

          if (dataLength <= 0 || totalLength > MAX_BUFFER_BYTES) {
            console.warn(
              `[INVALID FRAME LENGTH] imei=${session.imei} remote=${remote} dataLength=${dataLength} totalLength=${totalLength}`
            );
            socket.destroy();
            return;
          }

          if (session.buffer.length < totalLength) return;

          const frame = session.buffer.subarray(0, totalLength);
          session.buffer = session.buffer.subarray(totalLength);

          const codecId = frame.readUInt8(8);

          if (session.imei) {
            activeDevices.set(session.imei, {
              socket,
              lastSeenAt: Date.now(),
            });
          }

          if (codecId === 0x8e) {
            const packet = parseTcpAvlPacket(frame);

            const ack = Buffer.alloc(4);
            ack.writeUInt32BE(packet.recordCount, 0);
            socket.write(ack);

            void saveRecordsToFirestore(session.imei, packet.records).catch((error) => {
              console.error(`[FIRESTORE SAVE ERROR] imei=${session.imei}`, error);
            });

            continue;
          }

if (codecId === 0x0c) {
  const packet = parseCodec12Packet(frame);

  console.log(
    `[CODEC12 RESPONSE] imei=${session.imei} type=0x${packet.type.toString(16)} qty1=${packet.quantity1} qty2=${packet.quantity2} payload="${packet.payload}"`
  );

  const pending = pendingCodec12ByImei.get(session.imei);

  if (pending) {
    pendingCodec12ByImei.delete(session.imei);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    const ok = isCodec12SuccessPayload(packet.payload);

    void db
      .collection("vehicles")
      .doc(pending.vehicleId)
      .collection("commands")
      .doc(pending.commandId)
      .update({
        status: ok ? "completed" : "failed",
        result: ok ? "success" : "failed",
        providerMessage: packet.payload || "",
        responseType: packet.type,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      })
      .catch((error) => {
        console.error("[COMMAND RESPONSE UPDATE ERROR]", error);
      });
  }

  continue;
}

          console.warn(
            `[UNSUPPORTED CODEC] imei=${session.imei} codec=0x${codecId.toString(16)}`
          );
        }
      }
    } catch (error) {
      console.error(`[TCP ERROR] ${remote}`, error);
      socket.destroy();
    }
  });

  socket.on("error", (error) => {
    clearActiveDeviceIfMatches(session.imei, socket);
    console.error(`[SOCKET ERROR] ${remote}`, error);
  });

  socket.on("close", () => {
    clearActiveDeviceIfMatches(session.imei, socket);
    if (!session.imei) {
      console.log(`[TCP DISCONNECTED] ${remote}`);
    }
  });
});

server.on("error", (error) => {
  console.error("[SERVER ERROR]", error);
});

watchVehicleCommands();
startCleanupScheduler();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[SERVER STARTED] GPS gateway listening on 0.0.0.0:${PORT}`);
});