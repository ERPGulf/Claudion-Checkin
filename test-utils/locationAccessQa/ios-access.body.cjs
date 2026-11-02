const { Platform } = qaRequire('node_modules/react-native/index.js');
if (Platform.OS !== 'ios') throw new Error('iOS only');
const storage = qaRequire('node_modules/@react-native-async-storage/async-storage/src/index.ts').default;
const tenant = await storage.getItem('baseUrl');
if (tenant !== 'http://localhost:8765') throw new Error('Disposable local QA tenant only');
const native = qaRequire('modules/expo-auto-attendance/index.js');
return { observedAt: new Date().toISOString(), platform: Platform.OS,
  access: native.getLocationAccessState(), fullAccuracy: native.hasFullAccuracy(),
  monitoring: native.isMonitoring(), registered: native.getRegisteredGeofences() };
