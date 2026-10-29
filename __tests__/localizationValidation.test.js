const { validateResources, auditSource, auditRepository } = require('../scripts/validate-localization.cjs');

test('offline catalogues and literal UI call sites are complete and consistent', () => {
  const report = auditRepository();
  expect(report.resourceErrors).toEqual([]);
  expect(report.conflictingTranslations).toEqual([]);
  expect(report.missingKeys).toEqual([]);
  expect(report.untranslated).toEqual([]);
  expect(report.summary.namespaces).toEqual(expect.arrayContaining(['common', 'auth', 'hr', 'attendance']));
});

test('validation rejects empty entries, missing keys and interpolation corruption', () => {
  const result = validateResources({
    en: { common: { greeting: 'Hello {{name}}', blank: 'Present', onlyEnglish: 'Only English' } },
    ar: { common: { greeting: 'مرحبًا {{other}}', blank: '' } },
  });
  expect(result.errors).toEqual(expect.arrayContaining([
    expect.stringContaining('interpolation mismatch greeting'),
    expect.stringContaining('empty or malformed blank'),
    expect.stringContaining('missing onlyEnglish'),
  ]));
});

test('source audit identifies visible literals and missing keys without treating API values as copy', () => {
  const result = auditSource(`
    const route = 'AttendanceAction';
    const payload = { log_type: 'IN' };
    export const Screen = () => <Button label="Check in" accessibilityLabel={t('missing')} />;
  `, 'screens/fixture.jsx', new Set(['Check in']));
  expect(result.untranslated).toEqual([expect.objectContaining({ value: 'Check in' })]);
  expect(result.missingKeys).toEqual([expect.objectContaining({ key: 'missing' })]);
});
