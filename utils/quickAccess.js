/**
 * Everything a user can pin to Home.
 *
 * `id` is the identity Redux matches on and is persisted inside each pinned
 * entry, so ids must never be reused or renumbered — 3, 5, 6, 8 and 13 stay
 * retired (3, 5 and 6 were the never-shipped Vacation request / My Card /
 * Contacts entries; 13 was Salary advance and 8 was Trip details, both pulled
 * from the picker).
 * `iconName` has to stay unique too: both the picker grid and Home's Quick
 * Access row key their tiles by it.
 *
 * `url` must match a route registered in navigation/app-navigator.jsx —
 * __tests__/quickAccessOptions.test.js enforces that.
 */
export const QUICK_ACCESS_OPTIONS = [
  {
    id: 1,
    iconName: 'calendar-outline',
    text1: 'Attendance',
    text2: 'action',
    url: 'Attendance action',
  },
  {
    id: 2,
    iconName: 'receipt-outline',
    text1: 'Attendance',
    text2: 'history',
    url: 'Attendance history',
  },
  {
    id: 9,
    iconName: 'clipboard-outline',
    text1: 'Attendance',
    text2: 'request',
    url: 'Attendance request',
  },
  {
    id: 10,
    iconName: 'location-outline',
    text1: 'Automatic',
    text2: 'attendance',
    url: 'Auto attendance',
  },
  {
    id: 12,
    iconName: 'document-text-outline',
    text1: 'Leave',
    text2: 'request',
    url: 'Leave request',
  },
  {
    id: 11,
    iconName: 'wallet-outline',
    text1: 'Expense',
    text2: 'claim',
    url: 'Expense claim',
  },
  {
    id: 15,
    iconName: 'cash-outline',
    text1: 'Loan',
    text2: 'application',
    url: 'Loan application',
  },
  {
    id: 14,
    iconName: 'chatbox-ellipses-outline',
    text1: 'Complaints',
    url: 'Complaints',
  },
  {
    id: 4,
    iconName: 'list-outline',
    text1: 'Vacation',
    text2: 'list',
    url: 'comingsoon',
  },
  {
    id: 7,
    iconName: 'qr-code-outline',
    text1: 'My QR',
    url: 'My QR Code',
  },
];

const OFFERED_IDS = new Set(QUICK_ACCESS_OPTIONS.map(option => option.id));

/**
 * Pins live in redux-persist, so a shortcut retired from the picker would
 * otherwise sit on Home forever — visible, still navigating, and impossible to
 * unpin because the picker no longer lists it. Drop those on read instead of
 * migrating the persisted state.
 */
export function filterOfferedShortcuts(pinned) {
  if (!Array.isArray(pinned)) return [];
  return pinned.filter(item => OFFERED_IDS.has(item?.id));
}
