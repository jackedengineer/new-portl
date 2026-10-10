import type {
  Flat,
  Invitation,
  ResidentApplication,
  Society,
  Tower,
} from '../generated/prisma/client.js';

export const societyView = (society: Society) => ({
  id: society.id,
  name: society.name,
  isDemo: society.isDemo,
});
export const flatView = (flat: Flat & { tower: Tower }) => ({
  id: flat.id,
  label: flat.label,
  tower: flat.tower.name,
});
export const applicationInclude = {
  society: true,
  flat: { include: { tower: true } },
} as const;
export function applicationView(
  row: ResidentApplication & {
    society: Society;
    flat: Flat & { tower: Tower };
  },
) {
  return {
    id: row.id,
    society: societyView(row.society),
    flat: flatView(row.flat),
    name: row.name,
    relationship: row.relationship,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}
export function invitationView(
  row: Invitation & { flat: Flat & { tower: Tower } },
) {
  return {
    id: row.id,
    email: row.email,
    flat: flatView(row.flat),
    relationship: row.relationship,
    status: row.acceptedAt
      ? 'ACCEPTED'
      : row.revokedAt
        ? 'REVOKED'
        : row.expiresAt <= new Date()
          ? 'EXPIRED'
          : 'ACTIVE',
    expiresAt: row.expiresAt.toISOString(),
  };
}
