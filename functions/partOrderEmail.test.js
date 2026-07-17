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
  notes: 'Urgent pentru montaj.',
  clientOfferNotes: 'Oferta valabila 7 zile.',
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
  assert.match(email.body, /2 buc\n\nClient: Client Test/);
  assert.match(email.body, /Observatii: Urgent pentru montaj\.\n\nVa multumim/);
});

test('builds client offer only with client prices', () => {
  const email = buildClientPartOfferEmail(order);
  assert.match(email.body, /145\.00 RON/);
  assert.match(email.body, /290\.00 RON/);
  assert.doesNotMatch(email.body, /100\.00 RON/);
  assert.match(email.body, /Valoare totala oferta: 290\.00 RON\nObservatii: Oferta valabila 7 zile\.\n\nLocatie:/);
});
