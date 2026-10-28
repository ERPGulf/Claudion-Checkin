import { act, renderHook, waitFor } from '@testing-library/react-native';
import useShortcutData from '../hooks/useShortcutData';
import { activateAuthSession, getAuthSessionGeneration, invalidateAuthSession } from '../utils/authSessionGuard';

beforeEach(() => activateAuthSession(getAuthSessionGeneration()));

it('distinguishes request failure from a legitimate empty response and retries', async () => {
  const fetcher = jest.fn()
    .mockRejectedValueOnce(new Error('synthetic outage'))
    .mockResolvedValueOnce({ shortcut: 'Synthetic record', data: {} });
  const { result } = renderHook(() => useShortcutData('EMP-SYNTHETIC', fetcher));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe(true);

  act(() => result.current.retry());
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe(false);
  expect(result.current.data).toEqual({});
  expect(result.current.title).toBe('Synthetic record');
});

it('returns successful records without changing field or title mapping', async () => {
  const data = { synthetic_field: 'Synthetic value' };
  const fetcher = jest.fn().mockResolvedValue({ shortcut: 'Synthetic record', data });
  const { result } = renderHook(() => useShortcutData('EMP-SYNTHETIC', fetcher));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data).toEqual(data);
  expect(result.current.error).toBe(false);
});

it('does not leave a missing employee spinning or make a request', async () => {
  const fetcher = jest.fn();
  const { result } = renderHook(() => useShortcutData(null, fetcher));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});

it('discards a result after tenant/session invalidation', async () => {
  let resolve;
  const fetcher = jest.fn(() => new Promise(done => { resolve = done; }));
  const { result } = renderHook(() => useShortcutData('EMP-SYNTHETIC', fetcher));
  await waitFor(() => expect(resolve).toBeDefined());
  invalidateAuthSession();
  await act(async () => { resolve({ shortcut: 'Old tenant record', data: { stale: true } }); });
  expect(result.current.data).toEqual({});
  expect(result.current.title).toBe('Records');
  expect(result.current.error).toBe(false);
});

it('ignores an older employee response after a newer one arrives', async () => {
  let resolveOld;
  const fetcher = jest.fn()
    .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ shortcut: 'New employee', data: { current: true } });
  const { result, rerender } = renderHook(({ employee }) => useShortcutData(employee, fetcher), {
    initialProps: { employee: 'EMP-OLD-SYNTHETIC' },
  });
  rerender({ employee: 'EMP-NEW-SYNTHETIC' });
  await waitFor(() => expect(result.current.data).toEqual({ current: true }));
  await act(async () => { resolveOld({ shortcut: 'Old employee', data: { stale: true } }); });
  expect(result.current.data).toEqual({ current: true });
  expect(result.current.title).toBe('New employee');
});
