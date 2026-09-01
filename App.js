import { Provider } from "react-redux";
import { store, persistor } from "./redux/Store";
import "react-native-gesture-handler";
import Toast from "react-native-toast-message";
import { PersistGate } from "redux-persist/integration/react";
import { useState, useEffect, useRef } from "react";
import * as Font from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import Ionicons from "@expo/vector-icons/Ionicons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
// Hosts the <Toast> instance with a safe-area-derived offset; `Toast.show()`
// still comes from the library import above.
import AppToast from "./Toast/AppToast";
import Navigator from "./navigation/navigator";
import { navigateSafely } from "./navigation/rootNavigation";
import * as Updates from "expo-updates";
import { SafeAreaProvider } from "react-native-safe-area-context";
import UpdateBanner from "./components/UpdateBanner";
import ThemedStatusBar from "./components/common/ThemedStatusBar";
import OfflineBanner from "./components/common/OfflineBanner";
import AutoAttendanceBootstrap from "./components/AutoAttendanceBootstrap";
import OfflineAttendanceBootstrap from "./components/OfflineAttendanceBootstrap";
import FeatureSettingsBootstrap from "./components/FeatureSettingsBootstrap";
import { selectIsLoggedIn } from "./redux/Slices/AuthSlice";
import {
  initializeFcm,
  registerBackgroundMessageHandler,
  clearFcmRegistration,
} from "./services/notifications/fcm.service";
import { registerSessionCleanupHandler } from "./services/api/apiClient";
import { clearOfflineAttendance } from "./services/offline/AttendanceQueueService";
import { hydrate as hydrateAppearance } from "./settings/appearance";
// TEMPORARY: New Home Experience experiment — remove with the feature.
import { hydrate as hydrateHomeExperience } from "./settings/homeExperience";
import { hydrate as hydrateOfflineSyncAlerts } from "./settings/offlineSyncAlerts";

function cacheFonts(fonts) {
  return fonts.map((font) => Font.loadAsync(font));
}
const queryClient = new QueryClient();
registerBackgroundMessageHandler();
// Forced logout (session expiry) reuses the same teardown as manual logout: the
// FCM registration and the cached attendance rules.
//
// It does NOT touch the offline attendance queue, and that is load-bearing. It
// used to: a queued automatic check-out whose upload was interrupted by the
// token expiring was deleted right here, so the server never learned the
// employee had left and the app went on to file a second check-in on top of the
// still-open session. Authentication state and attendance data are independent —
// see clearOfflineAttendance.
registerSessionCleanupHandler(async () => {
  await Promise.allSettled([clearFcmRegistration(), clearOfflineAttendance()]);
});

const getForegroundToastType = (type) => {
  if (typeof type !== "string") {
    return "notificationToast";
  }

  return type.toLowerCase() === "announcement"
    ? "announcementToast"
    : "notificationToast";
};

function FcmBootstrap() {
  const dispatch = useDispatch();
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const teardownRef = useRef(() => {});

  useEffect(() => {
    let cancelled = false;

    const setupFcm = async () => {
      teardownRef.current();
      teardownRef.current = () => {};

      if (!isLoggedIn) {
        return;
      }

      const teardown = await initializeFcm({
        dispatch,
        onForegroundNotification: ({ title, body, type }) => {
          Toast.show({
            type: getForegroundToastType(type),
            text1: title,
            text2: body,
            onPress: () => {
              Toast.hide();
              navigateSafely("Notifications");
            },
            autoHide: true,
            visibilityTime: 3500,
          });
        },
      });

      if (cancelled) {
        teardown();
        return;
      }

      teardownRef.current = teardown;
    };

    setupFcm();

    return () => {
      cancelled = true;
      teardownRef.current();
      teardownRef.current = () => {};
    };
  }, [dispatch, isLoggedIn]);

  return null;
}

export default function App() {
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    const loadResourcesAndDataAsync = async () => {
      try {
        SplashScreen.preventAutoHideAsync();

        // Load fonts
        const IconAssets = cacheFonts([Ionicons.font]);
        await Promise.all([...IconAssets]);

        // Both must resolve before the navigator mounts. Appearance decides the
        // palette of the first paint; the Home variant decides which screen
        // component mounts, and getting it wrong remounts Home and fires its
        // focus effects (and their network calls) twice.
        await Promise.all([hydrateAppearance(), hydrateHomeExperience()]);

        // Not awaited with the two above: the banner is an overlay, so the worst
        // case is one frame before the preference lands. Blocking the splash on
        // it would be the worse trade.
        hydrateOfflineSyncAlerts().catch(() => {});

        if (!__DEV__ && Updates.isEnabled) {
          try {
            const update = await Updates.checkForUpdateAsync();

            if (update.isAvailable) {
              await Updates.fetchUpdateAsync();
              await Updates.reloadAsync();
            }
          } catch (error) {
            // Ignore OTA check failures during startup and continue booting.
          }
        }
      } catch (error) {
      } finally {
        setAppReady(true);
        SplashScreen.hideAsync();
      }
    };

    loadResourcesAndDataAsync();
  }, []);

  if (!appReady) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <Provider store={store}>
        <PersistGate persistor={persistor} loading={null}>
          <QueryClientProvider client={queryClient}>
            <FcmBootstrap />
            <AutoAttendanceBootstrap />
            <OfflineAttendanceBootstrap />
            {/* Fetches server-driven feature availability for the session. The
                navigator below does not wait on it — it renders off the
                persisted settings and re-renders if they change. */}
            <FeatureSettingsBootstrap />
            <Navigator />
            {/* Above the navigator so it floats over any screen, below AppToast
                so a transient toast still wins the top of the screen. */}
            <OfflineBanner />
            <UpdateBanner />
            <ThemedStatusBar />
            <AppToast />
          </QueryClientProvider>
        </PersistGate>
      </Provider>
    </SafeAreaProvider>
  );
}
