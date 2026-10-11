import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
type Context = readonly [societyId: string, passId: string, issuerId: string];
export function passCodes(secret: string) {
  if (Buffer.byteLength(secret) < 32)
    throw new Error('A strong root secret is required');
  const key = Buffer.from(
    hkdfSync('sha256', secret, 'portl', 'guest-pass-code:v1', 32),
  );
  const digest = (code: string) =>
    createHash('sha256').update(code).digest('hex');
  return {
    digest,
    create(context: Context) {
      const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      const code = [...randomBytes(16)].map((b) => alphabet[b & 31]).join('');
      const nonce = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(JSON.stringify(context)));
      const encrypted = Buffer.concat([
        cipher.update(code, 'utf8'),
        cipher.final(),
      ]);
      const cipherText = [
        'v1',
        nonce.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        encrypted.toString('base64url'),
      ].join('.');
      return { code, tokenHash: digest(code), cipherText };
    },
    reveal(cipherText: string, context: Context) {
      const [version, nonce, tag, data, extra] = cipherText.split('.');
      if (version !== 'v1' || !nonce || !tag || !data || extra)
        throw new Error('Invalid pass encryption');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(nonce, 'base64url'),
      );
      decipher.setAAD(Buffer.from(JSON.stringify(context)));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
export type PassCodes = ReturnType<typeof passCodes>;
