const babel = require('@babel/core');
const fs = require('fs');
const path = require('path');

/**
 * Every .jsx file in the app is a component that something imports by default.
 * A file that parses cleanly but exports nothing fails at runtime with React
 * Navigation's opaque "Got an invalid value for 'component' prop", so this is a
 * static check rather than a render test — it needs no native modules and
 * covers screens that can't be imported under jest (Firebase, camera).
 */
const ROOTS = ['screens', 'components', 'navigation'];

function collectJsx(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsx(full, out);
    else if (entry.name.endsWith('.jsx')) out.push(full);
  }
  return out;
}

function hasDefaultExport(file) {
  const ast = babel.parseSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    presets: ['babel-preset-expo'],
    babelrc: false,
    configFile: false,
  });

  let found = false;
  babel.traverse(ast, {
    ExportDefaultDeclaration() {
      found = true;
    },
    ExportNamedDeclaration(p) {
      if (
        (p.node.specifiers || []).some(s => s.exported?.name === 'default')
      ) {
        found = true;
      }
    },
  });
  return found;
}

const files = ROOTS.flatMap(root => collectJsx(root));

describe('component modules', () => {
  it('finds .jsx files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)('%s has a default export', file => {
    expect(hasDefaultExport(file)).toBe(true);
  });
});
