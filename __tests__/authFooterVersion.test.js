import appConfig from '../app.json';
import { describeAuthFooter } from '../utils/authFooter';
import { UPDATE_SOURCE } from '../utils/otaUpdate';

const UPDATE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

test('reports the installed native version before the OTA configuration version', () => {
  const result = describeAuthFooter({ nativeAppVersion: '1.2.1', expoVersion: '2.0.0' });
  expect(result.version).toBe('1.2.1');
  expect(describeAuthFooter({ nativeAppVersion: null, expoVersion: '2.0.0' }).version).toBe('2.0.0');
});

test('falls back to bundled configuration when runtime versions are unavailable or blank', () => {
  expect(describeAuthFooter().version).toBe(appConfig.expo.version);
  expect(describeAuthFooter({ nativeAppVersion: ' ', expoVersion: '' }).version).toBe(appConfig.expo.version);
});

test('identifies an applied OTA by the existing compact update UUID', () => {
  expect(describeAuthFooter({ updateId: UPDATE_ID })).toMatchObject({
    source: UPDATE_SOURCE.OTA,
    otaId: 'a1b2c3d4',
    otaLabelKey: null,
  });
});

test('does not mistake an embedded manifest UUID for an applied OTA', () => {
  expect(describeAuthFooter({ updateId: UPDATE_ID, isEmbeddedLaunch: true })).toMatchObject({
    source: UPDATE_SOURCE.EMBEDDED,
    otaId: null,
    otaLabelKey: 'Embedded',
  });
});

test.each([null, '', '   '])('reports the embedded bundle when update identity is %p', updateId => {
  expect(describeAuthFooter({ updateId })).toMatchObject({
    source: UPDATE_SOURCE.EMBEDDED,
    otaId: null,
    otaLabelKey: 'Embedded',
  });
});

test('distinguishes development from a production bundle with updates disabled', () => {
  expect(describeAuthFooter({ isEnabled: false, isDevelopment: true, updateId: UPDATE_ID })).toMatchObject({
    source: UPDATE_SOURCE.DEVELOPMENT,
    otaId: null,
    otaLabelKey: 'Development',
  });
  expect(describeAuthFooter({ isEnabled: false, isDevelopment: false, updateId: UPDATE_ID })).toMatchObject({
    source: UPDATE_SOURCE.EMBEDDED,
    otaId: null,
    otaLabelKey: 'Embedded',
  });
});
