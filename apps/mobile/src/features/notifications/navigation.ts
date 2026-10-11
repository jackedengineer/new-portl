import { notificationTapInput, type PortlNotification } from '@portl/contracts';
export async function notificationDestination(
  data: unknown,
  load: (id: string) => Promise<PortlNotification>,
) {
  const tap = notificationTapInput.safeParse(data);
  if (!tap.success) return null;
  const item = await load(tap.data.notificationId);
  return {
    pathname:
      item.resourceKind === 'PASS'
        ? ('/guest-pass' as const)
        : ('/visitor' as const),
    params: { id: item.resourceId, societyId: item.societyId, view: item.view },
  };
}
