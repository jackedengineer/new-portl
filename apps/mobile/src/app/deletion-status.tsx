import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { deletionStatusSchema } from '@portl/contracts';
import { api, messageOf } from '../lib/api';
import {
  Button,
  Copy,
  ErrorMessage,
  Field,
  Screen,
  Title,
} from '../components/ui';
import { clearReceipt, loadReceipt } from '../features/account/receipt';
export default function DeletionStatus() {
  const [token, setToken] = useState(''),
    [storageError, setStorageError] = useState('');
  const status = useMutation({
    mutationFn: () =>
      api('/account/deletion/status', deletionStatusSchema, {
        receiptToken: token,
      }),
  });
  useEffect(() => {
    let active = true;
    void loadReceipt()
      .then((value) => {
        if (active) setToken(value);
      })
      .catch(() => {
        if (active)
          setStorageError(
            'Could not read the saved receipt. Paste your copy below.',
          );
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Screen back eyebrow="Account deletion">
      <Title>Deletion status</Title>
      <Copy>
        Use the private receipt from your deletion request. No sign-in is
        needed. A receipt is available for 90 days after cleanup finishes.
      </Copy>
      <Field
        label="Private deletion receipt"
        value={token}
        onChangeText={(value) => {
          setToken(value);
          status.reset();
        }}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        maxLength={64}
      />
      <Button
        label="Check status"
        pending={status.isPending}
        disabled={!/^[a-f0-9]{64}$/.test(token)}
        onPress={() => status.mutate()}
      />
      {status.data && (
        <>
          <Copy>
            {status.data.status === 'COMPLETED'
              ? 'Your account and associated content have been removed from the active Portl database. Provider backups and already-delivered messages have the limits described in the privacy notice.'
              : 'Deletion is confirmed and sessions are revoked. Cleanup normally takes a few minutes while the worker is available. You can return here later.'}
          </Copy>
          <Copy small>
            Requested {new Date(status.data.requestedAt).toLocaleString()}
          </Copy>
        </>
      )}
      <ErrorMessage
        message={status.error ? messageOf(status.error) : storageError}
      />
      <Button
        label="Remove saved receipt from this device"
        variant="quiet"
        onPress={() =>
          void clearReceipt()
            .then(() => {
              setToken('');
              status.reset();
            })
            .catch(() =>
              setStorageError('Could not remove the saved receipt. Try again.'),
            )
        }
      />
    </Screen>
  );
}
