export const LOCATION_ACCESS_KIND = {
  LOST: 'LOCATION_ACCESS_LOST',
  RECOVERED: 'LOCATION_ACCESS_RECOVERED',
};

export const LOCATION_ACCESS_LOSS_REASONS = new Set([
  'services-disabled', 'foreground-permission-lost',
  'background-permission-lost', 'precise-permission-lost',
]);

const validCoordinates = value => Number.isFinite(value?.latitude) &&
  Math.abs(value.latitude) <= 90 && Number.isFinite(value?.longitude) && Math.abs(value.longitude) <= 180;

/** Shared with both native recovery implementations; keep metres unrounded. */
export const locationAccessDistance = (a, b) => {
  const radians = value => value * Math.PI / 180;
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const angle = Math.sin(latitude / 2) ** 2 + Math.cos(radians(a.latitude)) *
    Math.cos(radians(b.latitude)) * Math.sin(longitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.max(0, angle)), Math.sqrt(Math.max(0, 1 - angle)));
};

/** Accuracy is a distance in metres, never evidence that authorization was revoked. */
export const classifyOfficePresence = (office, position, { requestedAt = 0 } = {}) => {
  if (!validCoordinates(office) || !validCoordinates(position) ||
    !Number.isFinite(office.radius) || office.radius <= 0 ||
    !Number.isFinite(position.horizontalAccuracy) || position.horizontalAccuracy < 0 ||
    !Number.isFinite(position.timestamp) || position.timestamp <= 0 ||
    position.timestamp < requestedAt) return 'uncertain';
  const distance = locationAccessDistance(office, position);
  if (!Number.isFinite(distance)) return 'uncertain';
  if (distance + position.horizontalAccuracy <= office.radius) return 'inside';
  if (distance - position.horizontalAccuracy > office.radius) return 'outside';
  return 'uncertain';
};

/** Control receipts are not physical ENTER/EXIT observations. Unknown kinds never authorize work. */
export const autoEventAttendanceType = event => {
  if (event?.kind === LOCATION_ACCESS_KIND.LOST) return 'OUT';
  if (event?.kind === LOCATION_ACCESS_KIND.RECOVERED) return event.presence === 'inside' ? 'IN' : null;
  if (event?.kind != null) return null;
  return event?.transition === 'ENTER' ? 'IN' : event?.transition === 'EXIT' ? 'OUT' : null;
};

export const autoEventAttendanceAction = event => {
  const type = autoEventAttendanceType(event);
  return type === 'IN' ? 'checkin' : type === 'OUT' ? 'checkout' : null;
};
