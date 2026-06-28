// 🔖 OTA BUILD STAMP — single source of truth.
//
// Shown on the welcome (landing) screen and the login screen so we can confirm a
// device pulled the latest OTA. BUMP THE LETTER (A → B → C …) and set today's
// date EVERY TIME you publish an OTA (eas update). Change it HERE only — both
// screens import this value, so they can never drift out of sync.
export const BUILD_TAG = "2026-06-28 C";

export default BUILD_TAG;
