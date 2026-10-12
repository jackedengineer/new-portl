import { useLayoutEffect, useMemo } from 'react';
import { api } from '../../lib/api';
import type { z } from 'zod';
export const noticePath = (sid: string) =>
  `/societies/${encodeURIComponent(sid)}/notices`;
export const noticeKey = (uid: string, sid: string) =>
  ['notices', uid, sid] as const;
export function useNoticeRequest(userId: string, societyId: string) {
  const identity = useMemo(
    () => ({ userId, societyId, controller: new AbortController() }),
    [userId, societyId],
  );
  useLayoutEffect(() => () => identity.controller.abort(), [identity]);
  return {
    active: () => !identity.controller.signal.aborted,
    call: <T>(
      path: string,
      schema: z.ZodType<T>,
      body?: unknown,
      signal?: AbortSignal,
    ) =>
      api(
        `${noticePath(identity.societyId)}${path}`,
        schema,
        body,
        signal ?? identity.controller.signal,
        identity.userId,
      ),
  };
}
