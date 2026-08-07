import { getPreciseDistance } from "geolib";

/**
 * Where the office is, and whether you are in it.
 *
 * Lifted out of `attendance.service.js#getOfficeLocation` so the offline gate
 * can answer the same question from cached configuration that the online path
 * answers from a fresh fetch. Two copies of this arithmetic would be the worst
 * kind of bug to own: they would agree in the office and disagree at the
 * boundary, which is the only place it matters.
 *
 * Pure — no storage, no network, no GPS. The caller supplies the fix.
 */

const parseCoordinateValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Reads a reporting location's coordinates.
 *
 * Two shapes exist in the wild and both are supported, in this order:
 *  1. `reporting_location` — a GeoJSON FeatureCollection string as written by
 *     the Frappe geolocation control, whose coordinates are [lng, lat].
 *  2. Flat `latitude` / `longitude` fields.
 *
 * @returns {{latitude: number, longitude: number, source: string}|null}
 */
export const resolveLocationCoordinates = (location) => {
  try {
    const parsed = JSON.parse(location?.reporting_location || "{}");
    const coords = parsed?.features?.[0]?.geometry?.coordinates;

    if (Array.isArray(coords) && coords.length === 2) {
      const [lng, lat] = coords;
      const longitude = parseCoordinateValue(lng);
      const latitude = parseCoordinateValue(lat);

      if (latitude !== null && longitude !== null) {
        return { latitude, longitude, source: "reporting_location" };
      }
    }
  } catch {
    // Malformed GeoJSON is not fatal — fall through to the flat fields.
  }

  const latitude = parseCoordinateValue(location?.latitude);
  const longitude = parseCoordinateValue(location?.longitude);

  if (latitude !== null && longitude !== null) {
    return { latitude, longitude, source: "lat_lng_fields" };
  }

  return null;
};

const sanitizeNumber = (value, defaultValue = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

/**
 * Scores every configured location against a fix.
 *
 * `withinRadius` is false for a location with no configured radius rather than
 * true — an unconfigured fence is not an infinite one, and defaulting it open
 * would let anyone check in from anywhere the moment an admin left the field
 * blank.
 *
 * @param {{latitude: number, longitude: number}} coords the device's fix
 * @param {Array<object>} locations raw `employee_locations` rows
 * @param {(info: object) => void} [onInvalid] called for each unusable row, so
 *        the caller can log it without this function knowing how it logs
 * @returns {Array<object>} one candidate per usable location
 */
export const scoreLocations = (coords, locations, onInvalid) => {
  if (!coords || !Array.isArray(locations)) return [];

  return locations
    .map((location, index) => {
      const resolved = resolveLocationCoordinates(location);

      if (!resolved) {
        onInvalid?.({ index, locationName: location?.location });
        return null;
      }

      const distance = getPreciseDistance(
        { latitude: coords.latitude, longitude: coords.longitude },
        { latitude: resolved.latitude, longitude: resolved.longitude },
      );

      const radius = sanitizeNumber(location?.reporting_radius);

      return {
        locationName: location?.location || `location-${index + 1}`,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        source: resolved.source,
        distance,
        radius,
        withinRadius: radius > 0 ? distance <= radius : false,
      };
    })
    .filter(Boolean);
};

/** The closest candidate, or null when there are none. */
export const pickNearest = (candidates) => {
  if (!Array.isArray(candidates) || !candidates.length) return null;

  return candidates.reduce((picked, current) => {
    if (!picked) return current;
    return current.distance < picked.distance ? current : picked;
  }, null);
};

/**
 * The whole question in one call: given a fix and the configured locations,
 * which office is nearest and are we inside it?
 *
 * @returns {object|null} the nearest candidate, or null when nothing is usable
 */
export const findNearestLocation = (coords, locations, onInvalid) =>
  pickNearest(scoreLocations(coords, locations, onInvalid));

export default {
  findNearestLocation,
  pickNearest,
  resolveLocationCoordinates,
  scoreLocations,
};
