/** Older binaries keep QR sign-in even when the native crypto module is absent. */
export const isMobileAuthAvailable = () =>
  typeof globalThis.crypto?.getRandomValues === "function";

export const installMobileAuthCrypto = () => {
  if (isMobileAuthAvailable()) return true;

  try {
    // A static import would crash binaries built before ExpoCrypto was added.
    const crypto = require("expo-crypto");
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    getRandomValues(new Uint8Array(1));
    if (!globalThis.crypto) globalThis.crypto = {};
    globalThis.crypto.getRandomValues = getRandomValues;
  } catch {
    // Capability-gated entry points keep these binaries on the existing QR path.
  }

  return isMobileAuthAvailable();
};
