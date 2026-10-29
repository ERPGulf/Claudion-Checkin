import appConfig from '../app.json';
import { shortUpdateId, UPDATE_SOURCE } from './otaUpdate';

const nonemptyVersion = value =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * Compact, locale-independent identity for an authentication footer.
 *
 * OTA updates have UUIDs rather than an application-defined version number.
 * An embedded manifest can also have a UUID, so only show that ID when the
 * running bundle was downloaded. Return translation keys, not cached copy.
 * Native/config values are injected by the presentation component; no native
 * module or update request is needed to describe the running bundle.
 */
export function describeAuthFooter({
  nativeAppVersion,
  expoVersion,
  updateId,
  isEmbeddedLaunch = false,
  isEnabled = true,
  isDevelopment = false,
} = {}) {
  const version = nonemptyVersion(nativeAppVersion) ||
    nonemptyVersion(expoVersion) || appConfig.expo.version;
  const id = shortUpdateId(updateId);

  if (isDevelopment) {
    return {
      version,
      source: UPDATE_SOURCE.DEVELOPMENT,
      otaId: null,
      otaLabelKey: 'Development',
    };
  }

  // expo-updates loads the embedded bundle when updates are disabled too.
  if (!isEnabled || isEmbeddedLaunch || !id) {
    return {
      version,
      source: UPDATE_SOURCE.EMBEDDED,
      otaId: null,
      otaLabelKey: 'Embedded',
    };
  }

  return {
    version,
    source: UPDATE_SOURCE.OTA,
    otaId: id,
    otaLabelKey: null,
  };
}
