#!/usr/bin/env node
// Host-only UI QA: invokes the same display preferences as Profile.
const { evaluate } = require('./cdp.cjs');
const [variant, mode = 'light', language = 'en'] = process.argv.slice(2);
if (!['modern', 'legacy', 'restore'].includes(variant) || !['light', 'dark', 'system'].includes(mode) || !['en', 'ar'].includes(language)) {
  throw new Error('Usage: ios-presentation.cjs modern|legacy|restore [light|dark|system] [en|ar]');
}
evaluate('1271e32336f8cbd7d1f8bb70b60a2b993e893292-1', `
  const storage = qaRequire('node_modules/@react-native-async-storage/async-storage/src/index.ts').default;
  if (await storage.getItem('baseUrl') !== 'http://localhost:8765') throw new Error('Disposable local QA tenant only');
  const appearance = qaRequire('settings/appearance.js');
  const home = qaRequire('settings/homeExperience.js');
  const locale = qaRequire('localization/index.js');
  if (!globalThis.__qaOriginalPresentation) globalThis.__qaOriginalPresentation = {
    mode: appearance.getSnapshot(), modern: home.getSnapshot(), language: locale.getLanguage()
  };
  const next = qaArgs.variant === 'restore' ? globalThis.__qaOriginalPresentation : {
    mode: qaArgs.mode, modern: qaArgs.variant === 'modern', language: qaArgs.language
  };
  await home.setEnabled(next.modern);
  await appearance.setMode(next.mode);
  await locale.setLanguage(next.language);
  qaRequire('navigation/rootNavigation.js').navigateSafely('Auto attendance');
  return { mode: appearance.getSnapshot(), modern: home.getSnapshot(), language: locale.getLanguage() };
`, 45000, { variant, mode, language }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
