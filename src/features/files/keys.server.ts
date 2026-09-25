import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';

export function fileKeys(): Record<string, string> {
  try {
    const input = process.env.INVENTORY_FILE_KEYS_JSON;
    const parsed: unknown = input
      ? JSON.parse(input)
      : {
          [process.env.INVENTORY_FILE_KEY_ID ?? '']:
            process.env.INVENTORY_FILE_KEY_SECRET,
        };
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          /^[a-z0-9]{4,32}$/.test(key) &&
          typeof value === 'string' &&
          value.length >= 32,
      ),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}
export function mac(secret: string, input: string) {
  return createHmac('sha256', secret).update(input).digest('hex');
}
export function proof(
  secret: string,
  actor: string,
  operation: string,
  args: string[],
) {
  const nonce = randomBytes(16).toString('hex');
  const expires = Math.floor(Date.now() / 1000) + 60;
  return {
    p_nonce: nonce,
    p_expires: expires,
    p_mac: mac(secret, [actor, operation, ...args, nonce, expires].join(':')),
  };
}
