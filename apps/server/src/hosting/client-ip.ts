import type { Request } from 'express';
import { isValidIP, normalizeIP } from '@better-auth/core/utils/ip';

export type TrustedIngress = 'none' | 'render';
export const CLIENT_IPV6_SUBNET = 64;

export function requestClientIP(request: Request): string {
  // Render mode is valid only with its Cloudflare public ingress and no
  // direct/private bypass. Never infer trust from a caller-provided header.
  const raw =
    request.app.get('portl trusted ingress') === 'render'
      ? request.get('cf-connecting-ip')
      : request.socket.remoteAddress;
  return raw && isValidIP(raw)
    ? normalizeIP(raw, { ipv6Subnet: CLIENT_IPV6_SUBNET })
    : '127.0.0.1'; // Invalid edge metadata shares one conservative bucket.
}
