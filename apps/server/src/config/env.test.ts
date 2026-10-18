import { describe, expect, it } from 'vitest';

import { parseRuntimeEnv } from './env.js';

describe('runtime environment', () => {
  it('starts local development with safe non-secret defaults', () => {
    expect(parseRuntimeEnv({})).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      TRUST_PROXY_HOPS: 0,
      LOG_LEVEL: 'info',
    });
  });

  it('requires an explicit single-hop ingress and rejects blanket or longer proxy trust', () => {
    expect(parseRuntimeEnv({ TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
    for (const value of ['true', '*', '2', '-1', ''])
      expect(() => parseRuntimeEnv({ TRUST_PROXY_HOPS: value })).toThrow(
        'TRUST_PROXY_HOPS',
      );
  });

  it('uses the port supplied by the host', () => {
    expect(parseRuntimeEnv({ PORT: '8080', NODE_ENV: 'production' }).PORT).toBe(
      8080,
    );
  });

  it.each(['', '0', '-1', '65536', '3000.5'])(
    'rejects invalid port %j',
    (port) => {
      expect(() => parseRuntimeEnv({ PORT: port })).toThrow('PORT');
    },
  );

  it('reports the invalid field without exposing its value', () => {
    const secret = 'do-not-print-this-value';
    try {
      parseRuntimeEnv({ PORT: secret });
      expect.fail('Invalid configuration was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('PORT');
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('does not include provider secrets in runtime configuration', () => {
    expect(parseRuntimeEnv({ RESEND_API_KEY: 'private' })).not.toHaveProperty(
      'RESEND_API_KEY',
    );
  });
});
