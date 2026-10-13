import * as Location from "expo-location";
import * as Native from "../modules/expo-auto-attendance";
import { resolveLocationCoordinates, pickNearest, scoreLocations } from "./attendanceLocations";
import { assertAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";

export const createRegistrationId = ({ tenantKey, employeeId, latitude, longitude, radius, geotagging }) =>
  JSON.stringify([tenantKey, employeeId, Native.OFFICE_GEOFENCE_IDENTIFIER, latitude, longitude, radius, geotagging]);

export const validOffice = (office) => Number.isFinite(office?.latitude) &&
  Math.abs(office.latitude) <= 90 && Number.isFinite(office?.longitude) &&
  Math.abs(office.longitude) <= 180 && Number.isFinite(office?.radius) && office.radius > 0;

export const registeredOfficeMatches = (registered, desired) =>
  registered?.identifier === desired?.identifier &&
  registered?.tenantKey === desired?.tenantKey &&
  registered?.employeeId === desired?.employeeId &&
  registered?.registrationId === desired?.registrationId &&
  registered?.latitude === desired?.latitude && registered?.longitude === desired?.longitude &&
  (registered?.requestedRadius ?? registered?.radius) === desired?.radius && registered?.geotagging === desired?.geotagging;

const boundedPosition = async () => {
  let timer;
  try {
    return await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Location unavailable")), 8000); }),
    ]);
  } catch {
    return Location.getLastKnownPositionAsync({ maxAge: 120000, requiredAccuracy: 100 }).catch(() => null);
  } finally {
    clearTimeout(timer);
  }
};

/** A fix selects among offices; it never creates an attendance event. */
export const selectRegistrationOffice = async (config, registered = []) => {
  const candidates = (config?.locations ?? []).map((location, index) => {
    const coordinates = resolveLocationCoordinates(location);
    const configuredRadius = Number(location.reporting_radius);
    return {
      ...coordinates,
      radius: configuredRadius > 0 ? configuredRadius : 100,
      locationName: location.location || `location-${index + 1}`,
    };
  }).filter(validOffice);
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return null;
  const position = await boundedPosition();
  if (position?.coords) {
    return pickNearest(scoreLocations(position.coords, candidates.map(office => ({
      ...office, location: office.locationName, reporting_radius: office.radius,
    }))));
  }
  // Without a fix retain a still-configured office, never choose a different one.
  return candidates.find(office => registered.some(fence =>
    fence.latitude === office.latitude && fence.longitude === office.longitude && (fence.requestedRadius ?? fence.radius) === office.radius,
  )) ?? null;
};

let registrations = Promise.resolve();
export const reconcileAutoAttendanceRegistration = (scope, config) => {
  const task = registrations.then(async () => {
    if (!scope || !config || ![1, 2].includes(Number(config.rules?.geotagging))) {
      await Native.stopGeofence();
      return null;
    }
    await assertAttendanceQueueScope(scope);
    if (config.tenantKey !== scope.tenantKey || config.employeeId !== scope.employeeId) return null;
    const [foreground, background] = await Promise.all([
      Location.getForegroundPermissionsAsync(), Location.getBackgroundPermissionsAsync(),
    ]);
    await assertAttendanceQueueScope(scope);
    if (foreground.status !== "granted" || background.status !== "granted" || !Native.hasFullAccuracy()) {
      await Native.stopGeofence();
      return null;
    }
    const registered = Native.getRegisteredGeofences() ?? [];
    const office = await selectRegistrationOffice(config, registered);
    await assertAttendanceQueueScope(scope);
    if (!office) {
      // A removed office must not remain active while selecting a replacement.
      const configured = config.locations.some(location => {
        const coords = resolveLocationCoordinates(location);
        const radius = Number(location.reporting_radius) > 0 ? Number(location.reporting_radius) : 100;
        return registered.some(fence => fence.latitude === coords?.latitude && fence.longitude === coords?.longitude &&
          (fence.requestedRadius ?? fence.radius) === radius && fence.tenantKey === scope.tenantKey && fence.employeeId === scope.employeeId &&
          fence.geotagging === Number(config.rules?.geotagging));
      });
      if (!configured) await Native.stopGeofence();
      return null;
    }
    const desired = { ...office, identifier: Native.OFFICE_GEOFENCE_IDENTIFIER,
      tenantKey: scope.tenantKey, employeeId: scope.employeeId, geotagging: Number(config.rules.geotagging) };
    desired.registrationId = createRegistrationId(desired);
    if (Native.isMonitoring() && registered.length === 1 && registeredOfficeMatches(registered[0], desired)) return desired;
    await Native.stopGeofence();
    await assertAttendanceQueueScope(scope);
    let timeout;
    try {
      await Promise.race([
        Native.startGeofence(desired),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Geofence registration timed out")), 20000); }),
      ]);
    } catch (error) {
      // Native stop invalidates pending starts before a delayed callback can win.
      await Native.stopGeofence();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    await assertAttendanceQueueScope(scope);
    return desired;
  });
  registrations = task.catch(() => {});
  return task;
};
