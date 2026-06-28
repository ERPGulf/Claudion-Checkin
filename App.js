import { Provider } from "react-redux";
import { store, persistor } from "./redux/Store";
import "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import Toast from "react-native-toast-message";
import { PersistGate } from "redux-persist/integration/react";
import { useState, useEffect, useRef } from "react";
import * as Font from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Platform } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
import { SIZES } from "./constants";
import { toastConfig } from "./Toast/Config";
import Navigator from "./navigation/navigator";
import { navigateSafely } from "./navigation/rootNavigation";
import * as Updates from "expo-updates";
import { SafeAreaProvider } from "react-native-safe-area-context";
import UpdateBanner from "./components/UpdateBanner";
import { selectIsLoggedIn } from "./redux/Slices/AuthSlice";
import {
  initializeFcm,
  registerBackgroundMessageHandler,
  clearFcmRegistration,
} from "./services/notifications/fcm.service";
import { registerSessionCleanupHandler } from "./services/api/apiClient";
import {
  installConsoleCapture,
  loadPersistedEntries,
  recordEvent,
} from "./utils/diagnosticLog";

// Capture logs into an in-app buffer so release/preview APKs (no Metro / adb)
// can export diagnostics from the Diagnostics screen. Installed at module load
// so it captures from the earliest possible point.
installConsoleCapture();
loadPersistedEntries().then(() => recordEvent("app/start", { __DEV__ }));

function cacheFonts(fonts) {
  return fonts.map((font) => Font.loadAsync(font));
}
const queryClient = new QueryClient();
registerBackgroundMessageHandler();
// Forced logout (session expiry) reuses the same FCM cleanup as manual logout.
registerSessionCleanupHandler(clearFcmRegistration);

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
            <Navigator />
            <UpdateBanner />
            <StatusBar style="auto" />
            <Toast
              topOffset={
                Platform.OS === "ios" ? SIZES.topOffset + 55 : SIZES.topOffset
              }
              config={toastConfig}
            />
          </QueryClientProvider>
        </PersistGate>
      </Provider>
    </SafeAreaProvider>
  );
}
