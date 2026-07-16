const { randomBytes } = require('node:crypto');

function createGmailMimeBoundary(now = Date.now(), randomBytesFn = randomBytes) {
  return `workcontrol_${now}_${randomBytesFn(6).toString('hex')}`;
}

module.exports = {
  createGmailMimeBoundary,
};
