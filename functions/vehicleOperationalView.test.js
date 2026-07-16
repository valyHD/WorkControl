const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVehicleOperationalView } = require('./vehicleOperationalView');

test('vehicle operational view excludes high-frequency GPS and tracker fields', () => {
  const view = buildVehicleOperationalView('vehicle-1', {
    companyId: 'company-a',
    plateNumber: 'B33LGR',
    tracker: { imei: '123456789012345', protocol: 'Codec8E', lastSeenAt: 123 },
    gpsSimHistory: [{
      destinationQuery: 'secret destination query',
      points: [{ lat: 44, lng: 26, ts: 100, rawIo: { 66: 1 } }],
    }],
    liveDiagnostics: { rawIo: { 66: 1 }, imei: '123456789012345' },
    gpsSnapshot: {
      lat: 44,
      lng: 26,
      speedKmh: 12,
      imei: '123456789012345',
      rawIo: { 66: 1 },
    },
  });

  assert.equal(view.companyId, 'company-a');
  assert.equal(Object.hasOwn(view, 'gpsSnapshot'), false);
  assert.equal(Object.hasOwn(view, 'tracker'), false);
  assert.equal(Object.hasOwn(view, 'gpsDataUsage'), false);
  assert.equal(Object.hasOwn(view, 'updatedAt'), false);
  assert.equal(Object.hasOwn(view, 'gpsSim'), false);
  assert.equal(Object.hasOwn(view, 'gpsSimHistory'), false);
  assert.equal(Object.hasOwn(view, 'liveDiagnostics'), false);
});

test('GPS-only updates produce the same operational payload', () => {
  const base = {
    companyId: 'company-a',
    plateNumber: 'B33LGR',
    currentKm: 6200,
    gpsSnapshot: { lat: 44, lng: 26, speedKmh: 10 },
    tracker: { lastSeenAt: 100 },
    updatedAt: 100,
  };
  const next = {
    ...base,
    gpsSnapshot: { lat: 44.1, lng: 26.1, speedKmh: 30 },
    tracker: { lastSeenAt: 200 },
    liveDiagnostics: { engineRpm: 2500 },
    updatedAt: 200,
  };

  assert.deepEqual(
    buildVehicleOperationalView('vehicle-1', base),
    buildVehicleOperationalView('vehicle-1', next)
  );
});
