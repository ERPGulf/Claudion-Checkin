return {
  runtime: typeof globalThis.HermesInternal === 'object' ? 'Hermes' : 'unknown',
  platform: qaRequire('node_modules/react-native/index.js').Platform.OS,
  modules: Array.from(globalThis.__r.getModules()).map(([, module]) => module.verboseName)
    .filter(name => name && /(?:redux\/Store|AsyncStorage|async-storage\/.*index|expo-auto-attendance\/index|react-native\/index)/.test(name)),
};
