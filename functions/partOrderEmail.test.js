const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildClientPartOfferEmail,
  buildSupplierQuoteRequestEmail,
} = require('./partOrderEmail');

const order = {
  title: 'Role usa',
  clientName: 'Client Test',
  addressLabel: 'Strada Test 1',
  liftSerialNumber: '210869',
  lines: [
    {
      id: 'line-1',
      name: 'Rola usa',
      code: 'RU-1',
      quantity: 2,
      unit: 'buc',
      supplierOfferUnitPrice: 100,
      clientOfferUnitPrice: 145,
    },
  ],
};

test('builds supplier request with client lift and quantities', () => {
  const email = buildSupplierQuoteRequestEmail(order);
  assert.match(email.subject, /Role usa/);
  assert.match(email.body, /Rola usa, cod RU-1, 2 buc/);
  assert.match(email.body, /Client: Client Test/);
  assert.match(email.body, /Numar lift: 210869/);
});

test('builds client offer only with client prices', () => {
  const email = buildClientPartOfferEmail(order);
  assert.match(email.body, /145\.00 RON/);
  assert.match(email.body, /290\.00 RON/);
  assert.doesNotMatch(email.body, /100\.00 RON/);
});
