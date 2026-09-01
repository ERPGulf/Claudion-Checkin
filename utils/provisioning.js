import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether this device has been provisioned against a tenant.
 *
 * The app is multi-tenant with no server URL in code: a QR scan writes
 * `baseUrl`, `api_key` and `app_key`, and `useLogin` exchanges those plus the
 * user's password for a token. Those three keys are **device provisioning**, not
 * credentials — nothing in the logout path removes them (`clearTokens` takes
 * only the token/FCM keys), so they survive a session expiry, a manual logout
 * and a restart.
 *
 * That is the whole point of this module. The auth navigator used to open on
 * `welcome`, whose only action is the QR scanner, so every session expiry sent
 * an already-provisioned employee back through re-provisioning to reach a
 * password field that was ready for them the entire time.
 *
 * Single source of truth for the rule, shared with `useLogin`'s "QR code not
 * scanned" guard so the screen you land on and the screen that will let you in
 * can never disagree.
 */

export const PROVISIONING_KEYS = ['baseUrl', 'api_key', 'app_key'];

/**
 * Reads the provisioning triple.
 *
 * Never throws: storage failing is not evidence that the device is provisioned,
 * and the callers' safe fallback is to treat it as unprovisioned (which offers
 * the QR scanner) rather than to crash on the way to a login screen.
 *
 * @returns {Promise<{baseUrl: string|null, api_key: string|null,
 *                    app_key: string|null, provisioned: boolean}>}
 */
export const readProvisioning = async () => {
  try {
    const entries = await AsyncStorage.multiGet(PROVISIONING_KEYS);
    const values = Object.fromEntries(entries);

    const baseUrl = values.baseUrl || null;
    const api_key = values.api_key || null;
    const app_key = values.app_key || null;

    return { baseUrl, api_key, app_key, provisioned: !!(baseUrl && api_key && app_key) };
  } catch {
    return { baseUrl: null, api_key: null, app_key: null, provisioned: false };
  }
};

/** `readProvisioning().provisioned`, for callers that need nothing else. */
export const isProvisioned = async () => (await readProvisioning()).provisioned;

export default { PROVISIONING_KEYS, isProvisioned, readProvisioning };
