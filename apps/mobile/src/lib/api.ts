import { Platform } from 'react-native';
import { z } from 'zod';
import { apiURL, authClient } from './auth-client';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
  expectedUserId?: string,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(cancel, 15_000);
  try {
    const cookie = Platform.OS === 'web' ? '' : await authClient.getCookie();
    const response = await fetch(`${apiURL}/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(expectedUserId ? { 'x-portl-expected-user': expectedUserId } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(Platform.OS === 'web'
          ? {}
          : { 'expo-origin': 'portl://', ...(cookie ? { cookie } : {}) }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const parsed = errorSchema.safeParse(data);
      throw new ApiError(
        response.status,
        parsed.success ? parsed.data.error.code : 'REQUEST_FAILED',
        parsed.success
          ? parsed.data.error.message
          : 'Unable to complete this request. Please try again.',
      );
    }
    const result = schema.safeParse(data);
    if (!result.success)
      throw new ApiError(
        502,
        'INVALID_RESPONSE',
        'We could not read the server response. Please try again.',
      );
    return result.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      'CONNECTION_ERROR',
      'Could not connect. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
export const successSchema = z.object({ success: z.boolean() });
export const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
