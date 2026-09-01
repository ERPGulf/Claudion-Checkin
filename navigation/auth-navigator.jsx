import { createNativeStackNavigator } from "@react-navigation/native-stack";

import React, { useEffect, useState } from "react";
import { Login, QrScan, WelcomeScreen } from "../screens";
import { readProvisioning } from "../utils/provisioning";

const Stack = createNativeStackNavigator();

/**
 * Where an unauthenticated app opens.
 *
 * Two different situations arrive here and they need different first screens:
 *
 *  - **Never provisioned.** No `baseUrl` / `api_key` / `app_key`, so there is no
 *    tenant to log in to yet. Welcome → QR scan, exactly as before.
 *  - **Provisioned, just not authenticated.** A token expired, a refresh failed,
 *    or the employee logged out. The tenant keys are all still in storage
 *    (nothing in the logout path removes them), so the only thing missing is a
 *    password — and sending this user to the QR scanner asks them to re-provision
 *    a device that never stopped being provisioned. This was a real support
 *    complaint, not a hypothetical.
 *
 * `initialRouteName` is only read when the navigator first mounts, so the
 * decision has to be made before rendering it — hence the null render below
 * rather than a default-then-redirect, which would flash the wrong screen.
 * AuthNavigator is mounted fresh each time `isLoggedIn` flips, so the check
 * re-runs on every logout and a QR scan mid-session is picked up next time.
 *
 * Onboarding is untouched: the QR route is still registered, Welcome still leads
 * to it, and the Login screen keeps its own "scan QR" button for re-provisioning
 * onto a different tenant.
 */
function AuthNavigator() {
  // null = undecided. Rendering the navigator before this resolves would bake in
  // whichever route happened to be the default.
  const [initialRoute, setInitialRoute] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { provisioned } = await readProvisioning();
      if (!cancelled) setInitialRoute(provisioned ? "login" : "welcome");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!initialRoute) return null;

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="login" component={Login} />
      <Stack.Screen name="Qrscan" component={QrScan} />
      <Stack.Screen name="welcome" component={WelcomeScreen} />
    </Stack.Navigator>
  );
}

export default AuthNavigator;
