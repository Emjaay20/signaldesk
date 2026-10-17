import { signWebhook, verifyWebhook } from '../src/webhooks/signature';

describe('webhook signatures', () => {
  const secret = 'whsec_test_secret';
  const body = '{"event":"case.opened"}';
  const timestamp = 1_700_000_000;

  it('round-trips a valid signature', () => {
    const header = signWebhook(secret, timestamp, body);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhook(secret, header, body, timestamp * 1000)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = signWebhook(secret, timestamp, body);
    expect(verifyWebhook(secret, header, '{"event":"nope"}', timestamp * 1000)).toBe(
      false,
    );
  });

  it('rejects a wrong secret', () => {
    const header = signWebhook(secret, timestamp, body);
    expect(verifyWebhook('whsec_other', header, body, timestamp * 1000)).toBe(
      false,
    );
  });
});
