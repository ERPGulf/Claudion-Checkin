/**
 * The Home menu grid and the Quick Access picker are two separate lists that
 * label the same features. They sit on adjacent screens — and for a pinned
 * shortcut, on the same screen — so any drift between them is visible.
 *
 * Both are read via jest.isolateModules with the icon font stubbed, because
 * they live in component modules.
 */
function loadLists() {
  let hr;
  let options;
  jest.isolateModules(() => {
    jest.doMock('@expo/vector-icons', () => ({
      Ionicons: () => null,
      MaterialCommunityIcons: () => null,
      AntDesign: () => null,
      Octicons: () => null,
      FontAwesome: () => null,
    }));
    hr = require('../components/Home/YourLavas').HR_FEATURES;
    options = require('../screens/SelectQuickAccess').QUICK_ACCESS_OPTIONS;
  });
  return { hr, options };
}

/**
 * "Attendance request" — first word capitalised, the rest lower case. Short
 * all-caps words are allowed through as acronyms, so "My QR" passes.
 */
function isSentenceCase(label) {
  const words = label.split(' ');
  if (words[0][0] !== words[0][0].toUpperCase()) return false;

  return words
    .slice(1)
    .every(
      word =>
        word === word.toLowerCase() ||
        (word === word.toUpperCase() && word.length <= 4),
    );
}

describe('feature labels', () => {
  it('writes every Home menu label in sentence case', () => {
    const { hr } = loadLists();
    const offenders = hr.map(f => f.label).filter(l => !isSentenceCase(l));

    expect(offenders).toEqual([]);
  });

  it('writes every Quick Access option in sentence case', () => {
    const { options } = loadLists();
    const offenders = options
      .map(o => `${o.text1} ${o.text2 || ''}`.trim())
      .filter(l => !isSentenceCase(l));

    expect(offenders).toEqual([]);
  });

  it('gives no Home menu item a per-item weight override', () => {
    // Two entries once carried `bold: true`, which drew them heavier than
    // their neighbours with nothing on screen to explain the difference.
    const { hr } = loadLists();

    hr.forEach(feature => expect(feature.bold).toBeUndefined());
  });

  it('labels a shared feature identically in both lists', () => {
    const { hr, options } = loadLists();
    const byRoute = new Map(hr.map(f => [f.nav, f.label]));

    const mismatched = options
      .filter(o => byRoute.has(o.url))
      .map(o => ({
        route: o.url,
        menu: byRoute.get(o.url),
        picker: `${o.text1} ${o.text2 || ''}`.trim(),
      }))
      .filter(pair => pair.menu !== pair.picker);

    expect(mismatched).toEqual([]);
  });

  it('overlaps the two lists on more than a couple of features', () => {
    // Guards the test above against silently passing on an empty intersection.
    const { hr, options } = loadLists();
    const routes = new Set(hr.map(f => f.nav));
    const shared = options.filter(o => routes.has(o.url));

    expect(shared.length).toBeGreaterThanOrEqual(8);
  });
});
