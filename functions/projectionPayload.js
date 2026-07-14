const crypto = require('node:crypto');

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
  return `{${entries.join(',')}}`;
}

function hashProjection(payload, version) {
  return crypto
    .createHash('sha256')
    .update(`${version}:${stableSerialize(payload)}`)
    .digest('hex');
}

function buildProjectionEnvelope(payload, version, sourceUpdatedAtMs) {
  return {
    ...payload,
    projectionVersion: version,
    projectionHash: hashProjection(payload, version),
    sourceUpdatedAtMs: Number(sourceUpdatedAtMs || 0),
  };
}

function shouldWriteProjection(current, next) {
  if (!current || typeof current !== 'object') return true;
  if (current.projectionHash === next.projectionHash) return false;
  const currentSourceUpdatedAtMs = Number(current.sourceUpdatedAtMs || 0);
  const nextSourceUpdatedAtMs = Number(next.sourceUpdatedAtMs || 0);
  return nextSourceUpdatedAtMs >= currentSourceUpdatedAtMs;
}

async function writeProjectionIfChanged({
  db,
  ref,
  payload,
  version,
  sourceUpdatedAtMs,
  serverTimestamp,
}) {
  const next = buildProjectionEnvelope(payload, version, sourceUpdatedAtMs);
  return db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(ref);
    const current = currentSnapshot.exists ? currentSnapshot.data() || {} : null;
    if (!shouldWriteProjection(current, next)) return false;

    transaction.set(
      ref,
      {
        ...next,
        updatedAtServer: serverTimestamp(),
      },
      { merge: false }
    );
    return true;
  });
}

module.exports = {
  buildProjectionEnvelope,
  hashProjection,
  shouldWriteProjection,
  stableSerialize,
  writeProjectionIfChanged,
};
