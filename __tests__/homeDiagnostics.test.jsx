import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import Home from '../screens/Home';
import HomeLegacy from '../screens/HomeLegacy';
import { fetchTopicsFromServer } from '../services/notifications/fcm.service';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({}),
  useFocusEffect: callback => require('react').useEffect(callback, [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('../hooks/useAppTheme', () => ({
  __esModule: true, default: () => ({ colors: { surfaceSecondary: 'white' } }),
}));
jest.mock('../components/Home', () => ({
  WelcomeCard: () => null, QuickAccess: () => null, LavaMenu: () => null,
}));
jest.mock('../components/HomeLegacy', () => ({
  WelcomeCard: () => null, QuickAccess: () => null, LavaMenu: () => null,
}));
jest.mock('../services/notifications/fcm.service', () => ({ fetchTopicsFromServer: jest.fn() }));

const originalDev = global.__DEV__;
let output;
beforeEach(() => {
  jest.clearAllMocks();
  global.__DEV__ = false;
  output = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  output.mockRestore();
  global.__DEV__ = originalDev;
});

describe.each([['modern', Home], ['legacy', HomeLegacy]])('%s Home diagnostics', (_name, Screen) => {
  it('reports the topic count without exposing private subscription names', async () => {
    const topics = ['SYNTHETIC-PRIVATE-EMPLOYEE-topic', 'SYNTHETIC-PRIVATE-TENANT-topic'];
    fetchTopicsFromServer.mockResolvedValue(topics);
    render(<Screen />);

    await waitFor(() => expect(output).toHaveBeenCalledWith('[Home] Topics count:', 2));
    expect(fetchTopicsFromServer).toHaveBeenCalledTimes(1);
    const diagnostics = JSON.stringify(output.mock.calls);
    topics.forEach(topic => expect(diagnostics).not.toContain(topic));
  });

  it('reports bounded status metadata without arbitrary backend error text or payloads', async () => {
    const secret = 'SYNTHETIC-PRIVATE-NOTIFICATION-ERROR';
    fetchTopicsFromServer.mockRejectedValue(Object.assign(new Error(secret), {
      code: 'ERR_BAD_RESPONSE', response: { status: 503, data: { private: secret } },
    }));
    render(<Screen />);

    await waitFor(() => expect(output).toHaveBeenCalledWith('[Home] fetchTopicsFromServer error:', {
      code: 'ERR_BAD_RESPONSE', httpStatus: 503,
    }));
    expect(fetchTopicsFromServer).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(output.mock.calls)).not.toContain(secret);
  });
});
