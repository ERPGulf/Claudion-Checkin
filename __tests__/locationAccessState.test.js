import { classifyOfficePresence, autoEventAttendanceType, locationAccessDistance } from '../utils/locationAccessState';

const office = { latitude: 0, longitude: 0, radius: 100 };
const position = { latitude: 0, longitude: 0, horizontalAccuracy: 10, timestamp: 2000 };

test('strict inside equality is accepted; a larger uncertainty circle stays uncertain', () => {
  expect(classifyOfficePresence(office, { ...position, horizontalAccuracy: 100 })).toBe('inside');
  expect(classifyOfficePresence(office, { ...position, horizontalAccuracy: 100.001 })).toBe('uncertain');
});

test('strict outside equality stays uncertain and only a wholly outside circle is outside', () => {
  const distant = { ...position, longitude: 0.002 };
  const distance = locationAccessDistance(office, distant);
  const boundary = { ...office, radius: distance - distant.horizontalAccuracy };
  expect(classifyOfficePresence(boundary, distant)).toBe('uncertain');
  expect(classifyOfficePresence({ ...boundary, radius: boundary.radius - 0.001 }, distant)).toBe('outside');
});

test.each([null, {}, { ...position, horizontalAccuracy: NaN }, { ...position, horizontalAccuracy: -1 },
  { ...position, latitude: 91 }, { ...position, timestamp: 0 }])('invalid or missing fix %p remains uncertain', fix => {
  expect(classifyOfficePresence(office, fix)).toBe('uncertain');
});

test('a cached fix cannot satisfy recovery proof', () => {
  expect(classifyOfficePresence(office, position, { requestedAt: 2001 })).toBe('uncertain');
  expect(classifyOfficePresence(office, position, { requestedAt: 2000 })).toBe('inside');
});

test('explicit control mapping never interprets unknown or outside recovery as OUT', () => {
  expect(autoEventAttendanceType({ kind: 'unrecognized', transition: 'EXIT' })).toBeNull();
  expect(autoEventAttendanceType({ kind: 'LOCATION_ACCESS_RECOVERED', presence: 'outside' })).toBeNull();
  expect(autoEventAttendanceType({ kind: 'LOCATION_ACCESS_LOST' })).toBe('OUT');
  expect(autoEventAttendanceType({ kind: 'LOCATION_ACCESS_RECOVERED', presence: 'inside' })).toBe('IN');
});
