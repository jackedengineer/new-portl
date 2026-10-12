import { useLayoutEffect, useMemo } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import { api, successSchema } from '../../lib/api';
import { useLiveGate } from '../gate/live';
export const operationKey = (uid: string, sid: string) =>
  ['operations', uid, sid] as const;
export function useOperationRequest(userId: string, societyId: string) {
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
        `/societies/${encodeURIComponent(identity.societyId)}${path}`,
        schema,
        body,
        signal ?? identity.controller.signal,
        identity.userId,
      ),
  };
}
export function useOperationList<T>(
  uid: string,
  sid: string,
  path: string,
  schema: z.ZodType<{ items: T[]; nextCursor: string | null }>,
) {
  const request = useOperationRequest(uid, sid),
    live = useLiveGate();
  const query = useInfiniteQuery({
    queryKey: [...operationKey(uid, sid), path],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      request.call(
        `${path}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        schema,
        undefined,
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: live.enabled ? 15000 : false,
    refetchOnWindowFocus: 'always',
  });
  return {
    query,
    items: query.error ? [] : (query.data?.pages.flatMap((p) => p.items) ?? []),
    online: live.online,
  };
}
export function useOperationCommand(
  uid: string,
  sid: string,
  onSaved?: () => void,
) {
  const request = useOperationRequest(uid, sid),
    client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      request.call(path, successSchema, body),
    onSuccess: () => {
      if (request.active()) {
        void client.invalidateQueries();
        onSaved?.();
      }
    },
    onError: () => {
      if (request.active())
        void client.invalidateQueries({ queryKey: operationKey(uid, sid) });
    },
  });
}
