#!/usr/bin/env node
/* Offline localization contract and source audit. No application/native imports. */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.resolve(__dirname, '..');
const DISPLAY_PROPS = new Set(['label', 'title', 'subtitle', 'description', 'message', 'placeholder', 'accessibilityLabel', 'accessibilityHint', 'actionLabel', 'emptyLabel', 'closeLabel', 'confirmLabel', 'cancelLabel', 'headerTitle']);
// Brand names, language autonyms, and file-format identifiers are intentionally invariant.
const INVARIANT_COPY = new Map([
  ['Claudion', 'Product name'], ['ERPGulf.com', 'Company domain'], ['erpgulf.com', 'Company domain'],
  ['erp.yourcompany.com', 'Synthetic URL example; machine-readable LTR'], ['English', 'Language autonym'], ['العربية', 'Language autonym'], ['PDF • JPG • PNG', 'File formats'],
]);
const PHRASE_RE = /[A-Za-z]/;
const tokens = value => [...value.matchAll(/{{-?\s*([\w.]+)(?:\s*,[^}]*)?\s*}}/g)].map(match => match[1]).sort();
const unique = list => [...new Set(list)];

function validateResources(resources) {
  const errors = [];
  const collisions = [];
  const catalogues = { en: {}, ar: {} };
  for (const namespace of unique([...Object.keys(resources.en || {}), ...Object.keys(resources.ar || {})])) {
    const en = resources.en?.[namespace] || {};
    const ar = resources.ar?.[namespace] || {};
    for (const key of unique([...Object.keys(en), ...Object.keys(ar)])) {
      for (const locale of ['en', 'ar']) {
        const source = locale === 'en' ? en : ar;
        if (!Object.hasOwn(source, key)) errors.push(`${locale}/${namespace}: missing ${key}`);
        else if (typeof source[key] !== 'string' || !source[key].trim()) errors.push(`${locale}/${namespace}: empty or malformed ${key}`);
      }
      if (typeof en[key] === 'string' && typeof ar[key] === 'string') {
        const english = unique(tokens(en[key]));
        const arabic = unique(tokens(ar[key]));
        // Arabic one/two/zero forms may express the quantity grammatically.
        const permittedOmissions = /_(zero|one|two)$/.test(key) ? ['count'] : [];
        if (english.some(token => !arabic.includes(token) && !permittedOmissions.includes(token)) || arabic.some(token => !english.includes(token))) {
          errors.push(`${namespace}: interpolation mismatch ${key}`);
        }
      }
      for (const locale of ['en', 'ar']) {
        const value = resources[locale]?.[namespace]?.[key];
        if (typeof value !== 'string') continue;
        const previous = catalogues[locale][key];
        if (previous && previous.value !== value) collisions.push({ locale, key, sources: [previous.namespace, namespace], values: [previous.value, value] });
        catalogues[locale][key] = { value, namespace };
      }
    }
  }
  return { errors, collisions, catalogues };
}

function auditSource(code, filename, keys) {
  const untranslated = [];
  const missingKeys = [];
  const invariant = [];
  const cataloguedSource = [];
  const dynamicCalls = [];
  const ast = parser.parse(code, { sourceType: 'unambiguous', plugins: ['jsx', ...(filename.endsWith('.ts') || filename.endsWith('.tsx') ? ['typescript'] : [])] });
  const hasKey = key => keys.has(key) || keys.has(`${key}_one`) && keys.has(`${key}_other`);
  const location = node => ({ file: filename, line: node.loc.start.line });
  const inspect = (node, value, context) => {
    if (!value || !PHRASE_RE.test(value)) return;
    if (INVARIANT_COPY.has(value)) { invariant.push({ ...location(node), value, reason: INVARIANT_COPY.get(value) }); return; }
    untranslated.push({ ...location(node), value, context });
  };
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type === 'Identifier' && callee.name === 't') {
        const arg = p.node.arguments[0];
        if (arg?.type === 'StringLiteral') {
          if (arg.value && !hasKey(arg.value)) missingKeys.push({ ...location(arg), key: arg.value });
        } else if (arg) dynamicCalls.push({ ...location(arg), expression: code.slice(arg.start, arg.end) });
      }
      if (callee.type === 'Identifier' && callee.name === 'alert' || callee.type === 'MemberExpression' && callee.object.name === 'Alert' && callee.property.name === 'alert') {
        p.node.arguments.slice(0, 2).forEach(arg => { if (arg.type === 'StringLiteral') inspect(arg, arg.value, 'alert'); });
      }
    },
    JSXText(p) {
      inspect(p.node, p.node.value.replace(/\s+/g, ' ').trim(), 'JSX text');
    },
    JSXAttribute(p) {
      if (DISPLAY_PROPS.has(p.node.name.name) && p.node.value?.type === 'StringLiteral') inspect(p.node.value, p.node.value.value, `attribute ${p.node.name.name}`);
    },
    StringLiteral(p) {
      const parent = p.parentPath;
      if (parent.isObjectProperty() && p.key === 'value' && ['label', 'title', 'subtitle', 'description', 'text1', 'text2', 'headerTitle'].includes(parent.node.key.name || parent.node.key.value)) {
        if (PHRASE_RE.test(p.node.value)) cataloguedSource.push({ ...location(p.node), value: p.node.value, translated: hasKey(p.node.value) });
      }
      // Literal branches directly rendered as text/visible props, excluding formatting/style/configuration.
      let current = p;
      while (current.parentPath && (current.parentPath.isConditionalExpression() || current.parentPath.isLogicalExpression() || current.parentPath.isArrayExpression())) current = current.parentPath;
      if (!current.parentPath?.isJSXExpressionContainer()) return;
      const host = current.parentPath.parentPath;
      if (host.isJSXAttribute() && !DISPLAY_PROPS.has(host.node.name.name)) return;
      inspect(p.node, p.node.value, 'rendered expression');
    },
  });
  return { untranslated, missingKeys, invariant, cataloguedSource, dynamicCalls };
}

function sourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || ['node_modules', 'ios', 'android', '__tests__', 'test-utils', 'scripts', 'assets', 'docs', 'build', 'dist'].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}

function auditRepository(root = ROOT) {
  const resources = { en: {}, ar: {} };
  for (const locale of ['en', 'ar']) {
    const directory = path.join(root, 'localization/locales', locale);
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort()) resources[locale][name.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  }
  const resourceAudit = validateResources(resources);
  const sourceAudit = { untranslated: [], missingKeys: [], invariant: [], cataloguedSource: [], dynamicCalls: [] };
  const keys = new Set(Object.keys(resourceAudit.catalogues.en));
  const files = sourceFiles(root).filter(file => !file.includes(`${path.sep}localization${path.sep}`));
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const audit = auditSource(fs.readFileSync(file, 'utf8'), relative, keys);
    for (const field of Object.keys(sourceAudit)) sourceAudit[field].push(...audit[field]);
  }
  return {
    summary: { files: files.length, namespaces: Object.keys(resources.en), englishKeys: Object.keys(resourceAudit.catalogues.en).length, arabicKeys: Object.keys(resourceAudit.catalogues.ar).length, resourceErrors: resourceAudit.errors.length, conflictingTranslations: resourceAudit.collisions.length, missingLiteralKeys: sourceAudit.missingKeys.length, unlocalizedSourceSites: sourceAudit.untranslated.length, dynamicTranslationCalls: sourceAudit.dynamicCalls.length },
    resourceErrors: resourceAudit.errors, conflictingTranslations: resourceAudit.collisions, ...sourceAudit,
    scope: 'Static application source audit. Dynamic tenant content, device/native dialogs, keyboard behavior, and layout require the documented platform review; cataloguedSource and dynamicCalls are reported for manual review, not claimed as proven coverage.',
  };
}

if (require.main === module) {
  const report = auditRepository();
  if (process.argv.includes('--report')) fs.writeFileSync(path.join(ROOT, 'docs/localization-coverage.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  for (const issue of report.resourceErrors) console.error(issue);
  for (const issue of report.missingKeys) console.error(`${issue.file}:${issue.line}: missing ${issue.key}`);
  for (const issue of report.untranslated) console.error(`${issue.file}:${issue.line}: untranslated ${JSON.stringify(issue.value)}`);
  for (const issue of report.conflictingTranslations) console.error(`Conflicting ${issue.locale} copy: ${issue.key}: ${issue.values.join(' / ')}`);
  if (report.resourceErrors.length || report.missingKeys.length || report.untranslated.length || report.conflictingTranslations.length) process.exitCode = 1;
}

module.exports = { validateResources, auditSource, auditRepository };
