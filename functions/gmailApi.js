async function sendRawGmailMessage({ accessToken, raw, fetchImpl = globalThis.fetch }) {
  if (!accessToken || !raw || typeof fetchImpl !== 'function') {
    throw new TypeError('Gmail send requires an access token, a raw message and fetch.');
  }

  return fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
}

module.exports = {
  sendRawGmailMessage,
};
