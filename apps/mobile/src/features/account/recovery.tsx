import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { openURL } from 'expo-linking';
import { useQuery } from '@tanstack/react-query';
import {
  adminRecoverySchema,
  recoveryEnrollmentSchema,
  recoveryConfirmInput,
} from '@portl/contracts';
import type { z } from 'zod';
import { api, messageOf, successSchema } from '../../lib/api';
import { useSession } from '../../auth/session';
import {
  Button,
  Card,
  Copy,
  ErrorMessage,
  Field,
  Label,
  Loading,
} from '../../components/ui';
type Enrollment = z.infer<typeof recoveryEnrollmentSchema>;
export function AdminRecovery({ userId }: { userId: string }) {
  const { forgetSession } = useSession();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null),
    [otp, setOtp] = useState(''),
    [totpCode, setTotpCode] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const recovery = useQuery({
    queryKey: ['admin-recovery', userId],
    queryFn: ({ signal }) =>
      api('/account/recovery', adminRecoverySchema, undefined, signal, userId),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const generation = useRef(0);
  const clearSensitive = useCallback(() => {
    generation.current++;
    setEnrollment(null);
    setOtp('');
    setTotpCode('');
    setConfirmation('');
    setPending(false);
  }, []);
  useFocusEffect(
    useCallback(() => {
      const subscription = AppState.addEventListener('change', (state) => {
        if (state !== 'active') clearSensitive();
      });
      return () => {
        subscription.remove();
        clearSensitive();
      };
    }, [clearSensitive]),
  );
  const request = recovery.data?.request;
  const { refetch } = recovery;
  useEffect(() => {
    if (!request) return;
    const timer = setTimeout(
      () => {
        clearSensitive();
        void refetch();
      },
      Math.max(0, Date.parse(request.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [request, clearSensitive, refetch]);
  async function enroll() {
    if (!request) return;
    setPending(true);
    setError('');
    const currentGeneration = generation.current;
    try {
      const result = await api(
        '/account/recovery/enroll',
        recoveryEnrollmentSchema,
        { id: request.id },
        undefined,
        userId,
      );
      if (generation.current === currentGeneration) setEnrollment(result);
    } catch (e) {
      if (generation.current === currentGeneration) setError(messageOf(e));
    } finally {
      if (generation.current === currentGeneration) setPending(false);
    }
  }
  async function confirm() {
    if (!request) return;
    setPending(true);
    setError('');
    const currentGeneration = generation.current;
    try {
      await api(
        '/account/recovery/confirm',
        successSchema,
        { id: request.id, otp, totpCode, confirmation },
        undefined,
        userId,
      );
      if (generation.current !== currentGeneration) return;
      setEnrollment(null);
      setOtp('');
      setTotpCode('');
      setConfirmation('');
      await forgetSession();
    } catch (e) {
      if (generation.current !== currentGeneration) return;
      setError(
        `${messageOf(e)} If confirmation may have succeeded, sign in again and check recovery status before retrying.`,
      );
    } finally {
      if (generation.current === currentGeneration) setPending(false);
    }
  }
  return (
    <Card>
      <Label>Admin recovery</Label>
      <Copy small>
        Contact the operator if your admin authenticator is lost or your society
        has no active admin. Recovery requires verified identity and society
        authority; support messages alone cannot grant access.
      </Copy>
      {recovery.isPending ? (
        <Loading label="Checking recovery requests…" />
      ) : recovery.error ? (
        <ErrorMessage message={messageOf(recovery.error)} />
      ) : request ? (
        <>
          <Copy>
            {request.operation === 'RESTORE_ADMIN'
              ? `Restore administration for ${request.societyName}`
              : 'Replace your admin authenticator'}
          </Copy>
          <Copy small>
            Expires {new Date(request.expiresAt).toLocaleTimeString()}. Continue
            only if you requested this. Completion replaces your account’s admin
            authenticator across all societies and signs out every device. Your
            existing roles are preserved.
          </Copy>
          {!enrollment || enrollment.id !== request.id ? (
            <Button
              label="Set up recovery authenticator"
              pending={pending}
              onPress={() => void enroll()}
            />
          ) : (
            <>
              <Copy small>
                Add a new entry in your authenticator using this setup key. Keep
                it private. The key is hidden when you leave this screen or
                background the app.
              </Copy>
              <Text selectable accessibilityLabel="Authenticator setup key">
                {enrollment.setupKey}
              </Text>
              <Button
                label="Open authenticator"
                variant="secondary"
                onPress={() =>
                  void openURL(enrollment.totpURI).catch(() =>
                    setError(
                      'No compatible authenticator opened. Add the setup key manually.',
                    ),
                  )
                }
              />
              <Field
                label="Recovery email code"
                value={otp}
                onChangeText={setOtp}
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
              />
              <Field
                label="New authenticator code"
                value={totpCode}
                onChangeText={setTotpCode}
                inputMode="numeric"
                maxLength={6}
              />
              <Field
                label="Type RECOVER to confirm"
                value={confirmation}
                onChangeText={setConfirmation}
                autoCapitalize="characters"
              />
              <Button
                label="Complete admin recovery"
                pending={pending}
                disabled={
                  !recoveryConfirmInput.safeParse({
                    id: request.id,
                    otp,
                    totpCode,
                    confirmation,
                  }).success
                }
                onPress={() => void confirm()}
              />
            </>
          )}
        </>
      ) : (
        <Copy small>
          {recovery.data?.completedAt
            ? `Recovery completed ${new Date(recovery.data.completedAt).toLocaleString()}. Use your new authenticator for admin actions.`
            : 'No pending recovery request. After operator verification, reload here to continue.'}
        </Copy>
      )}
      <ErrorMessage message={error} />
      <Button
        label="Refresh recovery status"
        variant="quiet"
        disabled={pending}
        onPress={() => {
          setEnrollment(null);
          setError('');
          void refetch();
        }}
      />
    </Card>
  );
}
