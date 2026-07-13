const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVehicleOperationalView } = require('./vehicleOperationalView');

test('vehicle operational view excludes tracker and diagnostic secrets', () => {
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
  assert.deepEqual(view.gpsSnapshot, { lat: 44, lng: 26, speedKmh: 12 });
  assert.deepEqual(view.tracker, { lastSeenAt: 123 });
  assert.equal(view.tracker.imei, undefined);
  assert.equal(view.tracker.protocol, undefined);
  assert.deepEqual(view.gpsSimHistory, [{ points: [{ lat: 44, lng: 26, ts: 100 }] }]);
  assert.equal(view.gpsSimHistory[0].destinationQuery, undefined);
  assert.equal(view.gpsSimHistory[0].points[0].rawIo, undefined);
  assert.equal(Object.hasOwn(view, 'liveDiagnostics'), false);
});
