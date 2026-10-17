import { useRef, useState, type ComponentProps } from 'react';
import { Button } from './ui';

/** Background query work stays quiet; only a requested refresh shows progress. */
export function RefreshButton({
  onRefresh,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, 'onPress' | 'pending'> & {
  onRefresh: () => Promise<unknown>;
}) {
  const running = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  function refresh() {
    if (running.current || disabled) return;
    running.current = true;
    setRefreshing(true);
    const finish = () => {
      running.current = false;
      setRefreshing(false);
    };
    // Query observers own the error display; release progress on either result.
    void Promise.resolve().then(onRefresh).then(finish, finish);
  }
  return (
    <Button
      {...props}
      disabled={disabled}
      pending={refreshing}
      onPress={refresh}
    />
  );
}
