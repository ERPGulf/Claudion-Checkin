import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import AppNavigator from "./app-navigator";
import AuthNavigator from "./auth-navigator";
import { navigationRef, flushPendingNavigation } from "./rootNavigation";

function Navigator() {
  const isLoggedIn = useSelector(selectIsLoggedIn);
  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={flushPendingNavigation}
      onStateChange={flushPendingNavigation}
    >
      {isLoggedIn ? <AppNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

export default Navigator;
