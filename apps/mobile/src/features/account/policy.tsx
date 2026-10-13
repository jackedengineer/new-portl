import { useState } from 'react';
import { openURL } from 'expo-linking';
import { POLICY_VERSION } from '@portl/contracts';
import { apiURL } from '../../lib/auth-client';
import { Button, Choice, Copy, ErrorMessage } from '../../components/ui';
export const policyAcceptance = {
  adult: true as const,
  termsVersion: POLICY_VERSION,
  privacyVersion: POLICY_VERSION,
};
export function LegalLinks() {
  const [error, setError] = useState('');
  return (
    <>
      {(['privacy', 'terms', 'support'] as const).map((path) => (
        <Button
          key={path}
          label={
            path === 'privacy'
              ? 'Privacy notice'
              : path === 'terms'
                ? 'Terms of use'
                : 'Support'
          }
          variant="quiet"
          onPress={() => {
            setError('');
            void openURL(`${apiURL}/${path}`).catch(() =>
              setError('Could not open this page. Check your connection.'),
            );
          }}
        />
      ))}
      <ErrorMessage message={error} />
    </>
  );
}
export function PolicyChoice({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <>
      <Copy small>
        Portl V1 is for adults. Read the privacy notice and terms before
        continuing. Push notifications remain optional.
      </Copy>
      <LegalLinks />
      <Choice
        role="checkbox"
        selected={accepted}
        label="I am 18 or older and accept the terms and privacy notice"
        onPress={() => onChange(!accepted)}
      />
    </>
  );
}
