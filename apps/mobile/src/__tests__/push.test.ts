import Constants from 'expo-constants';
import {
  enablePush,
  disablePush,
  refreshPush,
  pushAvailable,
  setPushIdentity,
} from '../features/notifications/native';
const mockApi = jest.fn(),
  mockImport = jest.fn(),
  mockPermission = jest.fn(),
  mockToken = jest.fn();
const mockStorage = new Map<string, string>();
jest.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  successSchema: {},
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    executionEnvironment: 'storeClient',
    expoConfig: {
      extra: { eas: { projectId: '5665c8f4-53e4-4975-820a-0ec30daf0981' } },
    },
  },
  ExecutionEnvironment: {
    StoreClient: 'storeClient',
    Standalone: 'standalone',
    Bare: 'bare',
  },
}));
jest.mock('expo-notifications', () => {
  mockImport();
  return {
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(),
    AndroidImportance: { HIGH: 4 },
    getPermissionsAsync: () => mockPermission(),
    requestPermissionsAsync: () => mockPermission(),
    getExpoPushTokenAsync: () => mockToken(),
  };
});
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockStorage.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockStorage.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockStorage.delete(key);
  },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => '5665c8f4-53e4-4975-820a-0ec30daf0981',
}));
const load = async () =>
  ({
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(),
    AndroidImportance: { HIGH: 4 },
    getPermissionsAsync: () => mockPermission(),
    requestPermissionsAsync: () => mockPermission(),
    getExpoPushTokenAsync: () => mockToken(),
    dismissAllNotificationsAsync: jest.fn(),
    clearLastNotificationResponseAsync: jest.fn(),
  }) as unknown as typeof import('expo-notifications');
beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
  setPushIdentity(null);
  Object.assign(Constants, { executionEnvironment: 'storeClient' });
});
it('does not import or request native push inside Expo Go', async () => {
  setPushIdentity('alice');
  expect(pushAvailable()).toBe(false);
  await expect(enablePush('alice')).rejects.toThrow('installed');
  expect(mockImport).not.toHaveBeenCalled();
  expect(mockPermission).not.toHaveBeenCalled();
  expect(mockApi).not.toHaveBeenCalled();
});
it('does not register a denied OS permission', async () => {
  Object.assign(Constants, { executionEnvironment: 'standalone' });
  setPushIdentity('alice');
  mockPermission.mockResolvedValue({ status: 'denied' });
  await expect(enablePush('alice', true, load)).rejects.toThrow('permission');
  expect(mockApi).not.toHaveBeenCalled();
});
it('cancels enrollment when the signed-in identity changes while a token is being fetched', async () => {
  Object.assign(Constants, { executionEnvironment: 'standalone' });
  setPushIdentity('alice');
  mockPermission.mockResolvedValue({ status: 'granted' });
  let finish!: (value: { data: string }) => void;
  mockToken.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = enablePush('alice', true, load);
  await new Promise((resolve) => setTimeout(resolve, 0));
  setPushIdentity('bob');
  finish({ data: 'ExpoPushToken[synthetic]' });
  await expect(pending).rejects.toThrow('session');
  expect(mockApi).not.toHaveBeenCalled();
});

it('keeps push disabled when automatic enrollment finishes after opting out', async () => {
  Object.assign(Constants, { executionEnvironment: 'standalone' });
  setPushIdentity('alice');
  mockStorage.set('portl.push.opt-in-user', 'alice');
  mockPermission.mockResolvedValue({ status: 'granted' });
  let finish!: (value: { data: string }) => void;
  mockToken.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = enablePush('alice', false, load);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await disablePush('alice', load);
  finish({ data: 'ExpoPushToken[synthetic]' });
  await expect(pending).rejects.toThrow();
  await refreshPush('alice', load);
  expect(mockApi).not.toHaveBeenCalledWith(
    '/notifications/devices/register',
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.anything(),
  );
  expect(mockStorage.has('portl.push.opt-in-user')).toBe(false);
});
it('removes a device after an already submitted registration finishes', async () => {
  Object.assign(Constants, { executionEnvironment: 'standalone' });
  setPushIdentity('alice');
  mockPermission.mockResolvedValue({ status: 'granted' });
  mockToken.mockResolvedValue({ data: 'ExpoPushToken[synthetic]' });
  const calls: string[] = [];
  let finish!: () => void;
  mockApi.mockImplementation((path: string) => {
    calls.push(path);
    return path.endsWith('/register')
      ? new Promise<void>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ success: true });
  });
  const pending = enablePush('alice', true, load);
  const rejected = expect(pending).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const disabled = disablePush('alice', load);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toEqual(['/notifications/devices/register']);
  finish();
  await rejected;
  await disabled;
  expect(calls).toEqual([
    '/notifications/devices/register',
    '/notifications/devices/remove',
  ]);
  expect(mockStorage.has('portl.push.opt-in-user')).toBe(false);
});
