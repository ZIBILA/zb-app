/**
 * Unit tests for validateWebhookSignature (Shiprocket / generic HMAC).
 *
 * Self-contained — duplicates the validation logic to avoid Prisma dependency.
 * Run with: npx tsx scripts/test-webhook-sig.ts
 */
import * as crypto from 'crypto';

function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!secret || !signature) return false;

  try {
    const cleanSignature = signature
      .replace(/^sha256=/i, '')
      .replace(/^Bearer\s+/i, '')
      .replace(/^Token\s+/i, '')
      .trim();
    const cleanSecret = secret.trim();

    const expectedSignature = crypto
      .createHmac('sha256', cleanSecret)
      .update(payload)
      .digest('hex');

    if (cleanSignature.length !== expectedSignature.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(cleanSignature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

const PAYLOAD = '{"awb":"123","status":"Delivered"}';
const SECRET = 'test_webhook_secret_value_12345';
const hmac = crypto.createHmac('sha256', SECRET).update(PAYLOAD).digest('hex');
const WRONG = 'not_the_secret';

function assert(cond: boolean, label: string) {
  if (!cond) {
    console.error('FAIL:', label);
    process.exitCode = 1;
  } else {
    console.log('ok:', label);
  }
}

console.log('\n── Shiprocket / generic HMAC ──');
assert(validateWebhookSignature(PAYLOAD, hmac, SECRET) === true, 'valid hmac');
assert(validateWebhookSignature(PAYLOAD, `sha256=${hmac}`, SECRET) === true, 'sha256= prefix');
assert(validateWebhookSignature(PAYLOAD, `Bearer ${hmac}`, SECRET) === true, 'Bearer prefix');
assert(validateWebhookSignature(PAYLOAD, hmac, WRONG) === false, 'wrong secret');
assert(validateWebhookSignature(PAYLOAD, '', SECRET) === false, 'empty signature');
assert(validateWebhookSignature(PAYLOAD, hmac, '') === false, 'empty secret');
assert(validateWebhookSignature(PAYLOAD, hmac.slice(0, 10), SECRET) === false, 'truncated signature');

console.log(process.exitCode ? '\nSome tests failed.' : '\nAll tests passed.');
