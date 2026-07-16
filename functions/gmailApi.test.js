const assert = require('node:assert/strict');
const test = require('node:test');

const { sendRawGmailMessage } = require('./gmailApi');

test('sends the MIME message directly through Gmail messages.send', async () => {
  const calls = [];
  const expectedResponse = { ok: true };

  const response = await sendRawGmailMessage({
    accessToken: 'access-token-test',
    raw: 'raw-message-test',
    fetchImpl: async (...args) => {
      calls.push(args);
      return expectedResponse;
    },
  });

  assert.equal(response, expectedResponse);
  assert.deepEqual(calls, [[
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer access-token-test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: 'raw-message-test' }),
    },
  ]]);
});

test('rejects incomplete Gmail send requests before calling the API', async () => {
  await assert.rejects(
    () => sendRawGmailMessage({ accessToken: '', raw: 'raw-message-test' }),
    /requires an access token/
  );
});
