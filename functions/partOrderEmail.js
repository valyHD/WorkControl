function cleanText(value, maxLength = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function money(value) {
  return `${toPositiveNumber(value).toFixed(2)} RON`;
}

function normalizeLines(order) {
  return Array.isArray(order?.lines)
    ? order.lines.slice(0, 50).map((line, index) => ({
        id: cleanText(line?.id, 120) || `line-${index + 1}`,
        name: cleanText(line?.name, 240) || 'Piesa',
        code: cleanText(line?.code, 120),
        quantity: Math.max(1, toPositiveNumber(line?.quantity) || 1),
        unit: cleanText(line?.unit, 30) || 'buc',
        notes: cleanText(line?.notes, 500),
        supplierOfferUnitPrice: toPositiveNumber(line?.supplierOfferUnitPrice || line?.estimatedPrice),
        clientOfferUnitPrice: toPositiveNumber(line?.clientOfferUnitPrice),
      }))
    : [];
}

function orderLabel(order) {
  return cleanText(order?.title, 180) ||
    [cleanText(order?.clientName, 120), cleanText(order?.liftSerialNumber, 120)].filter(Boolean).join(' - ') ||
    'Comanda piese';
}

function buildSupplierQuoteRequestEmail(order) {
  const lines = normalizeLines(order);
  const parts = lines.map((line, index) =>
    `${index + 1}. ${line.name}${line.code ? `, cod ${line.code}` : ''}, ${line.quantity} ${line.unit}${line.notes ? `, observatii: ${line.notes}` : ''}`
  );
  const body = [
    'Buna ziua,',
    '',
    'Va rugam sa ne transmiteti oferta pentru urmatoarele piese:',
    '',
    ...parts,
    '',
    `Client: ${cleanText(order?.clientName, 160) || '-'}`,
    `Adresa: ${cleanText(order?.addressLabel, 240) || '-'}`,
    `Numar lift: ${cleanText(order?.liftSerialNumber, 120) || '-'}`,
  ];
  if (cleanText(order?.neededByDate, 40)) {
    body.push(`Necesar pana la: ${cleanText(order.neededByDate, 40)}`);
  }
  if (cleanText(order?.notes, 1000)) {
    body.push(`Observatii: ${cleanText(order.notes, 1000)}`, '');
  } else {
    body.push('');
  }
  body.push('Va multumim,', 'Service si Mentenanta Lift');
  return {
    subject: `Cerere oferta piese - ${orderLabel(order)}`,
    body: body.join('\n'),
  };
}

function buildClientPartOfferEmail(order) {
  const lines = normalizeLines(order);
  const parts = lines.map((line, index) => {
    const lineTotal = line.quantity * line.clientOfferUnitPrice;
    return `${index + 1}. ${line.name}${line.code ? `, cod ${line.code}` : ''} - ${line.quantity} ${line.unit} x ${money(line.clientOfferUnitPrice)} = ${money(lineTotal)}`;
  });
  const calculatedTotal = lines.reduce((sum, line) => sum + line.quantity * line.clientOfferUnitPrice, 0);
  const total = calculatedTotal || toPositiveNumber(order?.clientOfferAmount);
  const body = [
    'Buna ziua,',
    '',
    `Va transmitem oferta pentru piesele necesare liftului ${cleanText(order?.liftSerialNumber, 120) || '-'}.`,
    '',
    ...parts,
    '',
    `Valoare totala oferta: ${money(total)}`,
  ];
  if (cleanText(order?.clientOfferNotes, 1000)) {
    body.push(`Observatii: ${cleanText(order.clientOfferNotes, 1000)}`, '');
  } else {
    body.push('');
  }
  if (cleanText(order?.addressLabel, 240)) {
    body.push(`Locatie: ${cleanText(order.addressLabel, 240)}`);
  }
  body.push('', 'Va rugam sa ne confirmati acceptarea ofertei.', '', 'Cu stima,', 'Service si Mentenanta Lift');
  return {
    subject: `Oferta piese - ${orderLabel(order)}`,
    body: body.join('\n'),
  };
}

module.exports = {
  buildClientPartOfferEmail,
  buildSupplierQuoteRequestEmail,
  normalizeLines,
};
