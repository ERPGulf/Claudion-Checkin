import { createNavigationContainerRef } from "@react-navigation/native";

export const navigationRef = createNavigationContainerRef();

let pendingNavigation = null;

const hasRoute = (state, routeName) => {
  if (!state || !routeName) {
    return false;
  }

  if (Array.isArray(state.routeNames) && state.routeNames.includes(routeName)) {
    return true;
  }

  if (!Array.isArray(state.routes)) {
    return false;
  }

  return state.routes.some((route) => hasRoute(route.state, routeName));
};

export const canNavigate = (routeName) => {
  if (!navigationRef.isReady()) {
    return false;
  }

  return hasRoute(navigationRef.getRootState(), routeName);
};

export const navigateSafely = (routeName, params) => {
  if (canNavigate(routeName)) {
    navigationRef.navigate(routeName, params);
    return true;
  }

  pendingNavigation = { routeName, params };
  return false;
};

export const flushPendingNavigation = () => {
  if (!pendingNavigation) {
    return false;
  }

  if (!canNavigate(pendingNavigation.routeName)) {
    return false;
  }

  const { routeName, params } = pendingNavigation;
  pendingNavigation = null;
  navigationRef.navigate(routeName, params);
  return true;
};

export const clearPendingNavigation = () => {
  pendingNavigation = null;
};
