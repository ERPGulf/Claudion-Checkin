const fs = require('fs');

/**
 * Quick Access options are only useful if tapping them navigates somewhere.
 * A pinned shortcut whose `url` has no matching route throws at the tap, far
 * from the array that caused it — so the route names are checked statically
 * against the navigator rather than by rendering anything.
 *
 * Route names are read out of the source because importing app-navigator.jsx
 * pulls in every screen, and most of them need native modules jest doesn't have.
 */
function registeredRoutes() {
  const source = fs.readFileSync('navigation/app-navigator.jsx', 'utf8');
  return [...source.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
}

/**
 * Every option now points at a registered route.
 *
 * `Trip details` used to be the one exception — it had no matching screen, so
 * pinning it and tapping it from Home threw. It has since been removed from the
 * picker, which is what emptied this list. Keep it empty: a new option with no
 * route is a bug, not something to allowlist.
 */
const KNOWN_MISSING_ROUTES = [];

describe('quick access options', () => {
  // Required lazily: the module is a screen, so it drags in the theme hooks.
  const load = () => {
    jest.doMock('@expo/vector-icons', () => ({ Ionicons: () => null }));
    // eslint-disable-next-line global-require
    return require('../screens/SelectQuickAccess').QUICK_ACCESS_OPTIONS;
  };

  it('exposes the option list', () => {
    expect(load().length).toBeGreaterThan(3);
  });

  it('gives every option a unique id', () => {
    const ids = load().map(o => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every option a unique iconName', () => {
    // Home's Quick Access row and the picker both key their tiles by iconName,
    // so a duplicate silently drops a tile.
    const icons = load().map(o => o.iconName);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('never reuses the retired ids 3, 5, 6, 8 and 13', () => {
    // 13 was Salary advance and 8 was Trip details: both were pinnable, so a
    // reused id would resurface under a persisted pin of the old feature.
    const ids = load().map(o => o.id);
    [3, 5, 6, 8, 13].forEach(retired => expect(ids).not.toContain(retired));
  });

  it('drops pins whose shortcut is no longer offered', () => {
    // eslint-disable-next-line global-require
    const { filterOfferedShortcuts } = require('../utils/quickAccess');
    const salaryAdvancePin = {
      id: 13,
      iconName: 'card-outline',
      text1: 'Salary',
      text2: 'advance',
      url: 'Salary advance',
    };

    expect(
      filterOfferedShortcuts([salaryAdvancePin, { id: 1 }]),
    ).toEqual([{ id: 1 }]);
    expect(filterOfferedShortcuts(undefined)).toEqual([]);
  });

  it('gives every option a label and a url', () => {
    load().forEach(option => {
      expect(typeof option.text1).toBe('string');
      expect(option.text1.length).toBeGreaterThan(0);
      expect(typeof option.url).toBe('string');
    });
  });

  it('points every option at a registered route', () => {
    const routes = registeredRoutes();
    const broken = load()
      .map(o => o.url)
      .filter(url => !routes.includes(url))
      .filter(url => !KNOWN_MISSING_ROUTES.includes(url));

    expect(broken).toEqual([]);
  });

  it('needs no route exemptions at all', () => {
    // Fails loudly if an exemption creeps back in, rather than letting one rot
    // in place the way `Trip details` did.
    expect(KNOWN_MISSING_ROUTES).toEqual([]);
  });
});
