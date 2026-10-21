import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useAttachmentPicker } from '../hooks/useAttachmentPicker';
import useComplaint from '../hooks/useComplaint';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { activateAuthSession, getAuthSessionGeneration, invalidateAuthSession } from '../utils/authSessionGuard';

let mockRoot;
jest.mock('../redux/Store', () => ({ store: { getState: () => mockRoot } }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../services/api/complaint.service', () => ({ createComplaint: jest.fn(), uploadComplaintAttachment: jest.fn() }));
jest.mock('../utils/HapticsMessage', () => ({ hapticsMessage: jest.fn() }));

const tenant = 'https://picker-alpha.example.test';
const employeeCode = 'EMP-PICKER';
const setEnabled = (enabled) => {
  mockRoot = { featureSettings: {
    settings: normalizeFeatureSettings({ complaints: enabled }),
    scope: buildSettingsScope(tenant, employeeCode),
    status: 'success', lastFetchedAt: Date.now(),
  } };
};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const picked = { canceled: false, assets: [{ uri: 'file:///synthetic/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' }] };

beforeEach(async () => {
  jest.clearAllMocks();
  activateAuthSession(getAuthSessionGeneration());
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([['baseUrl', tenant], ['employee_code', employeeCode]]);
  setEnabled(true);
  ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({ status: 'granted' });
  ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
  ImagePicker.launchCameraAsync.mockResolvedValue(picked);
  ImagePicker.launchImageLibraryAsync.mockResolvedValue(picked);
  DocumentPicker.getDocumentAsync.mockResolvedValue(picked);
});
afterEach(() => { cleanup(); jest.useRealTimers(); });

it.each([
  ['camera', 'pickFromCamera', () => ImagePicker.launchCameraAsync],
  ['gallery', 'pickFromGallery', () => ImagePicker.launchImageLibraryAsync],
  ['document', 'pickDocument', () => DocumentPicker.getDocumentAsync],
])('preserves enabled %s picking and refuses a retained invocation after disablement', async (_, method, native) => {
  const { result } = renderHook(() => useAttachmentPicker('complaints'));
  const retained = result.current[method];
  let file;
  await act(async () => { file = await retained(); });
  expect(file).toEqual(expect.objectContaining({ uri: picked.assets[0].uri, name: 'photo.jpg' }));
  native().mockClear();
  setEnabled(false);
  await act(async () => { expect(await retained()).toBeNull(); });
  expect(native()).not.toHaveBeenCalled();
});

it('does not launch the native camera after the owning complaint is disabled during its sheet timer', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useComplaint());
  act(() => { result.current.handlePickCamera(); });
  setEnabled(false);
  await act(async () => { await jest.advanceTimersByTimeAsync(400); });
  expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  expect(result.current.file).toBeNull();
});

it.each(['disable', 'unmount', 'reauthenticate', 'tenant switch'])(
  'does not launch the camera when %s occurs while its permission prompt is pending', async (change) => {
    const permission = deferred();
    ImagePicker.requestCameraPermissionsAsync.mockReturnValueOnce(permission.promise);
    const { result, unmount } = renderHook(() => useAttachmentPicker('complaints'));
    let pending;
    act(() => { pending = result.current.pickFromCamera(); });
    await waitFor(() => expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalled());
    if (change === 'disable') setEnabled(false);
    if (change === 'unmount') unmount();
    if (change === 'reauthenticate') activateAuthSession(invalidateAuthSession());
    if (change === 'tenant switch') await AsyncStorage.setItem('baseUrl', 'https://picker-beta.example.test');
    await act(async () => {
      permission.resolve({ status: 'granted' });
      expect(await pending).toBeNull();
    });
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  },
);

it.each(['disable', 'unmount', 'reauthenticate'])(
  'discards an already open document picker result after %s', async (change) => {
    const selection = deferred();
    DocumentPicker.getDocumentAsync.mockReturnValueOnce(selection.promise);
    const { result, unmount } = renderHook(() => useAttachmentPicker('complaints'));
    let pending;
    act(() => { pending = result.current.pickDocument(); });
    await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled());
    if (change === 'disable') setEnabled(false);
    if (change === 'unmount') unmount();
    if (change === 'reauthenticate') activateAuthSession(invalidateAuthSession());
    await act(async () => { selection.resolve(picked); expect(await pending).toBeNull(); });
  },
);

it('refuses a sheet timer retained after the owning screen unmounts', async () => {
  jest.useFakeTimers();
  const { result, unmount } = renderHook(() => useComplaint());
  act(() => { result.current.handlePickCamera(); });
  unmount();
  await act(async () => { await jest.advanceTimersByTimeAsync(400); });
  expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
});
