import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import * as Updates from 'expo-updates';

jest.mock('../localization', () => ({ hydrateLocale: jest.fn().mockResolvedValue() }));
jest.mock('../localization/LocaleRoot', () => ({ children }) => children);
jest.mock('../services/offline/AndroidAttendanceBackgroundTask', () => ({}));
jest.mock('react-native-gesture-handler', () => ({}));
jest.mock('react-native-toast-message', () => ({ show: jest.fn(), hide: jest.fn() }));
jest.mock('../redux/Store', () => ({ store: {}, persistor: {} }));
jest.mock('react-redux', () => ({
  Provider: ({ children }) => children,
  useDispatch: () => mockDispatch,
  useSelector: () => false,
}));
jest.mock('redux-persist/integration/react', () => ({ PersistGate: ({ children }) => children }));
jest.mock('@tanstack/react-query', () => ({ QueryClientProvider: ({ children }) => children }));
jest.mock('../services/queryClient', () => ({ queryClient: {} }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }) => children }));
jest.mock('expo-font', () => ({ loadAsync: jest.fn().mockResolvedValue() }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(),
  hideAsync: jest.fn().mockResolvedValue(),
}));
jest.mock('@expo/vector-icons/Ionicons', () => ({ font: {} }));
jest.mock('expo-updates', () => ({
  isEnabled: true,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));
jest.mock('../navigation/navigator', () => {
  const { Text } = require('react-native');
  return () => <Text>Useful screen</Text>;
});
jest.mock('../navigation/rootNavigation', () => ({ navigateSafely: jest.fn() }));
jest.mock('../Toast/AppToast', () => () => null);
jest.mock('../components/UpdateBanner', () => () => null);
jest.mock('../components/common/ThemedStatusBar', () => () => null);
jest.mock('../components/common/OfflineBanner', () => () => null);
jest.mock('../components/common/ErrorBoundary', () => ({ children }) => children);
jest.mock('../components/AutoAttendanceBootstrap', () => () => null);
jest.mock('../components/AutoAttendanceOnboarding', () => () => null);
jest.mock('../components/OfflineAttendanceBootstrap', () => () => null);
jest.mock('../components/FeatureSettingsBootstrap', () => () => null);
jest.mock('../components/CrashReportingBootstrap', () => () => null);
jest.mock('../services/notifications/fcm.service', () => ({
  initializeFcm: jest.fn(),
  registerBackgroundMessageHandler: jest.fn(),
  clearFcmRegistration: jest.fn(),
}));
jest.mock('../services/api/apiClient', () => ({ registerSessionCleanupHandler: jest.fn() }));
jest.mock('../services/offline/AttendanceQueueService', () => ({ clearOfflineAttendance: jest.fn() }));
jest.mock('../settings/appearance', () => ({ hydrate: jest.fn().mockResolvedValue() }));
jest.mock('../settings/homeExperience', () => ({ hydrate: jest.fn().mockResolvedValue() }));
jest.mock('../settings/offlineSyncAlerts', () => ({ hydrate: jest.fn().mockResolvedValue() }));
jest.mock('../utils/mobileAuthCrypto', () => ({ installMobileAuthCrypto: jest.fn() }));
jest.mock('../services/crashlytics.service', () => ({
  initializeCrashReporting: jest.fn(),
  recordNonFatalError: jest.fn(),
}));

import App from '../App';

const mockDispatch = jest.fn();
const originalDev = global.__DEV__;

afterEach(() => { global.__DEV__ = originalDev; });

it('mounts the useful screen without waiting on the update server in a release build', async () => {
  global.__DEV__ = false;
  Updates.checkForUpdateAsync.mockImplementation(() => new Promise(() => {}));

  const view = render(<App />);
  await waitFor(() => expect(view.getByText('Useful screen')).toBeTruthy());
  expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
});
