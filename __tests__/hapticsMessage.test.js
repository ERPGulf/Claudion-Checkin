import * as Haptics from 'expo-haptics';
import { hapticsMessage } from '../utils/HapticsMessage';

beforeEach(() => {
  Haptics.notificationAsync.mockReset().mockResolvedValue(undefined);
});

describe('best-effort haptic notifications', () => {
  it.each(['success', 'error', 'warning'])('keeps the %s notification synchronous and sends it once', type => {
    expect(hapticsMessage(type)).toBeUndefined();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(type);
  });

  it.each(['success', 'error', 'warning'])('consumes native rejection for %s without changing the caller contract', async type => {
    Haptics.notificationAsync.mockRejectedValueOnce(new Error('Native haptics unavailable'));
    expect(hapticsMessage(type)).toBeUndefined();
    await Promise.resolve();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'error', 'warning'])('ignores a synchronous native exception for %s', type => {
    Haptics.notificationAsync.mockImplementationOnce(() => { throw new Error('Native haptics unavailable'); });
    expect(hapticsMessage(type)).toBeUndefined();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown feedback types', () => {
    expect(hapticsMessage('other')).toBeUndefined();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});
