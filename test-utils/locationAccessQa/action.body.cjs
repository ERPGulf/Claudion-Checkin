const storage = qaRequire('node_modules/@react-native-async-storage/async-storage/src/index.ts').default;
const tenant = await storage.getItem('baseUrl');
if (!/^http:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2):8765\/?$/.test(tenant || '')) {
  throw new Error('Actions are restricted to the disposable localhost QA tenant');
}
const native = qaRequire('modules/expo-auto-attendance/index.js');
if (qaArgs.action === 'last-fix') return { fix: globalThis.__locationQaLastFix || null };
if (qaArgs.action === 'watch') {
  if (!globalThis.__locationQaWatch) {
    const location = qaRequire('node_modules/expo-location/build/index.js');
    globalThis.__locationQaWatch = await location.watchPositionAsync({ accuracy: location.Accuracy.Highest,
      timeInterval: 1000, distanceInterval: 0 }, point => {
      globalThis.__locationQaLastFix = { ...point.coords, timestamp: point.timestamp };
    });
  }
  return { watchActive: true, note: 'Real OS location request only; no attendance events injected.' };
}
if (qaArgs.action === 'stop-watch') {
  globalThis.__locationQaWatch?.remove();
  globalThis.__locationQaWatch = null;
  return { watchActive: false };
}
if (qaArgs.action === 'retry') {
  const startedAt = Date.now();
  const state = await native.retryLocationAccessRecovery();
  return { startedAt, endedAt: Date.now(), elapsedMs: Date.now() - startedAt, state };
}
if (qaArgs.action === 'access') return native.refreshLocationAccess();
if (qaArgs.action === 'navigate') {
  qaRequire('navigation/rootNavigation.js').navigateSafely(qaArgs.route);
  return { route: qaArgs.route };
}
if (qaArgs.action === 'locale') {
  await qaRequire('localization/index.js').setLanguage(qaArgs.language);
  return { language: qaArgs.language };
}
if (qaArgs.action === 'concurrent-retry') {
  const startedAt = Date.now();
  const first = native.retryLocationAccessRecovery().then(state => ({ which: 'first', elapsedMs: Date.now() - startedAt, state }));
  const second = native.retryLocationAccessRecovery().then(state => ({ which: 'second', elapsedMs: Date.now() - startedAt, state }));
  return { startedAt, attempts: await Promise.all([first, second]), endedAt: Date.now() };
}
throw new Error('Unknown host-only QA action');
