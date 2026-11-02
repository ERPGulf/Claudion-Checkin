const { Platform } = qaRequire('node_modules/react-native/index.js');
const storage = qaRequire('node_modules/@react-native-async-storage/async-storage/src/index.ts').default;
const { store, persistor } = qaRequire('redux/Store.js');
const actions = qaRequire('redux/Slices/UserSlice.js');
const native = qaRequire('modules/expo-auto-attendance/index.js');
const local = value => /^http:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2):8765\/?$/.test(value || '');
const previous = await storage.getItem('baseUrl');
if (previous && !local(previous)) throw new Error('Refusing to alter a non-QA tenant');
if (store.getState().userAuth?.isLoggedIn) throw new Error('Provision only a new signed-out disposable sandbox');
const origin = Platform.OS === 'android' ? 'http://10.0.2.2:8765' : 'http://localhost:8765';
const response = await fetch(`${origin}/__qa/fixture?platform=${Platform.OS}`);
if (!response.ok) throw new Error('Local fixture backend unavailable');
const fixture = await response.json();
if (!local(fixture.storage?.baseUrl) || !/^QA-(ANDROID|IOS)-001$/.test(fixture.storage?.employee_code)) {
  throw new Error('Fixture is not a disposable QA employee');
}
await storage.multiSet(Object.entries(fixture.storage));
store.dispatch(actions.setBaseUrl(fixture.reduxUser.baseUrl));
store.dispatch(actions.setUsername(fixture.reduxUser.username));
store.dispatch(actions.setFullname(fixture.reduxUser.fullname));
store.dispatch(actions.setEmployeeCode(fixture.reduxUser.userDetails.employeeCode));
await persistor.flush();
qaRequire('navigation/rootNavigation.js').navigateSafely('login');
return { platform: Platform.OS, tenant: fixture.storage.baseUrl, employee: fixture.storage.employee_code,
  loggedIn: store.getState().userAuth.isLoggedIn, nativeAvailable: native.isAvailable(),
  durableEvents: native.supportsDurableEvents(), accessEvents: native.supportsLocationAccessEvents(),
  note: 'QR provisioning fixture only; authenticate through the actual Login UI next.' };
