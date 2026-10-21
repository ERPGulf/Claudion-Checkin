import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import AppNavigator from "./app-navigator";
import AuthNavigator from "./auth-navigator";
import { navigationRef, flushPendingNavigation } from "./rootNavigation";
import { setCrashScreen } from "../services/crashlytics.service";

const handleNavigationChange = () => {
  flushPendingNavigation();
  setCrashScreen(navigationRef.getCurrentRoute()?.name);
};

function Navigator() {
  const isLoggedIn = useSelector(selectIsLoggedIn);
  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={handleNavigationChange}
      onStateChange={handleNavigationChange}
    >
      {isLoggedIn ? <AppNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

export default Navigator;
