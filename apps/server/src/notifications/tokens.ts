import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
export function tokenCipher(secret: string) {
  if (Buffer.byteLength(secret) < 32)
    throw new Error('A strong root secret is required');
  const key = Buffer.from(
    hkdfSync('sha256', secret, 'portl', 'push-device-token:v1', 32),
  );
  return {
    digest: (token: string) => createHash('sha256').update(token).digest('hex'),
    seal(token: string, installation: string, generation: string) {
      const nonce = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(JSON.stringify([installation, generation])));
      const data = Buffer.concat([
        cipher.update(token, 'utf8'),
        cipher.final(),
      ]);
      return [
        'v1',
        nonce.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        data.toString('base64url'),
      ].join('.');
    },
    open(sealed: string, installation: string, generation: string) {
      const [version, nonce, tag, data, extra] = sealed.split('.');
      if (version !== 'v1' || !nonce || !tag || !data || extra)
        throw new Error('Invalid token encryption');
      const cipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(nonce, 'base64url'),
      );
      cipher.setAAD(Buffer.from(JSON.stringify([installation, generation])));
      cipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        cipher.update(Buffer.from(data, 'base64url')),
        cipher.final(),
      ]).toString('utf8');
    },
  };
}
export type TokenCipher = ReturnType<typeof tokenCipher>;
