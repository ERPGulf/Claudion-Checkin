import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-US' }]) }));

function loadLocale() {
  let locale;
  jest.isolateModules(() => { locale = require('../localization'); });
  return locale;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test('resolves regional preferences, supported device order and English fallback', () => {
  const { normalizeLanguage, resolveLanguage } = loadLocale();
  expect(normalizeLanguage('AR_sa')).toBe('ar');
  expect(normalizeLanguage('en-GB')).toBe('en');
  expect(normalizeLanguage('fr')).toBeNull();
  expect(resolveLanguage('ar-SA', ['en-US'])).toBe('ar');
  expect(resolveLanguage(null, ['fr', { languageTag: 'ar-EG' }, 'en-US'])).toBe('ar');
  expect(resolveLanguage('corrupt', ['fr-FR'])).toBe('en');
});

test('hydrates explicit preference before device locale and survives reloading the module', async () => {
  const locale = loadLocale();
  await AsyncStorage.setItem(locale.LANGUAGE_KEY, 'ar-SA');
  await locale.hydrateLocale();
  expect(locale.getLanguage()).toBe('ar');
  expect(locale.getDirection()).toBe('rtl');
  expect(locale.t('Close')).toBe('إغلاق');
  await locale.setLanguage('en-US');
  expect(await AsyncStorage.getItem(locale.LANGUAGE_KEY)).toBe('en');
  const restarted = loadLocale();
  await restarted.hydrateLocale();
  expect(restarted.getLanguage()).toBe('en');
});

test('persists before publishing and coalesces duplicate requests', async () => {
  const locale = loadLocale();
  await locale.hydrateLocale();
  let finishWrite;
  AsyncStorage.setItem.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));
  const first = locale.setLanguage('ar');
  const duplicate = locale.setLanguage('ar');
  expect(first).toBe(duplicate);
  await Promise.resolve();
  expect(locale.getLanguage()).toBe('en');
  finishWrite();
  await first;
  expect(locale.getLanguage()).toBe('ar');
  expect(locale.getDirection()).toBe('rtl');
});

test('storage failure retains active locale and permits a later retry', async () => {
  const locale = loadLocale();
  await locale.hydrateLocale();
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(locale.setLanguage('ar')).rejects.toThrow('storage unavailable');
  expect(locale.getLanguage()).toBe('en');
  await locale.setLanguage('ar');
  expect(locale.getDirection()).toBe('rtl');
  await expect(locale.setLanguage('de')).rejects.toThrow('Unsupported');
});

test('real i18next interpolates and selects every Arabic plural category', async () => {
  const locale = loadLocale();
  await locale.setLanguage('ar');
  expect(locale.t('Profile: {{name}}', { name: 'Sara' })).toContain('Sara');
  const samples = [0, 1, 2, 3, 11, 102];
  const results = samples.map(count => locale.t('{{count}} records have not reached the server yet.', { count }));
  expect(new Set(results).size).toBe(6);
  results.forEach((result, index) => {
    expect(result).toMatch(/[\u0600-\u06ff]/);
    if (index >= 3) expect(result).toContain(String(samples[index]));
    expect(result).not.toContain('{{');
  });
});

test('formatters use selected locale with Gregorian calendar and Latin digits', async () => {
  const locale = loadLocale();
  const timestamp = new Date('2026-10-29T12:30:00Z');
  await locale.setLanguage('en');
  expect(locale.formatNumber(1234.5)).toBe('1,234.5');
  const english = locale.formatDate(timestamp, { timeZone: 'UTC' });
  await locale.setLanguage('ar');
  expect(locale.formatDate(timestamp, { timeZone: 'UTC' })).not.toBe(english);
  expect(locale.formatDate(timestamp, { timeZone: 'UTC' })).toContain('2026');
  expect(locale.formatTime(timestamp, { timeZone: 'UTC', hour12: false })).toContain('12:30');
  expect(locale.formatDuration(3660)).toBe('1 س 1 د');
  expect(locale.formatNumber(null)).toBe('');
  expect(locale.formatDate('not a timestamp')).toBe('');
  expect(timestamp.toISOString()).toBe('2026-10-29T12:30:00.000Z');
});

test('display isolation never mutates business values and unknown server text is preserved', () => {
  const locale = loadLocale();
  const identifier = 'EMP-001';
  expect(locale.isolateBidi(identifier)).toBe('\u2068EMP-001\u2069');
  expect(identifier).toBe('EMP-001');
  expect(locale.translateMessage('A server supplied document title')).toBe('A server supplied document title');
  expect(locale.translateMessage({ message: 'invalid' }, 'Something went wrong')).toBe('Something went wrong');
});
