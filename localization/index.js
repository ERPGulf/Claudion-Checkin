import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import commonEn from './locales/en/common.json';
import commonAr from './locales/ar/common.json';
import authEn from './locales/en/auth.json';
import authAr from './locales/ar/auth.json';
import hrEn from './locales/en/hr.json';
import hrAr from './locales/ar/hr.json';
import attendanceEn from './locales/en/attendance.json';
import attendanceAr from './locales/ar/attendance.json';

export const LANGUAGE_KEY = 'settings_language';
export const SUPPORTED_LANGUAGES = ['en', 'ar'];
export const FALLBACK_LANGUAGE = 'en';
export const resources = {
  en: { translation: { ...authEn, ...hrEn, ...attendanceEn, ...commonEn } },
  ar: { translation: { ...authAr, ...hrAr, ...attendanceAr, ...commonAr } },
};

/** Regional tags resolve to the supported base language; invalid preferences are ignored. */
export function normalizeLanguage(value) {
  if (typeof value !== 'string') return null;
  const base = value.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  return SUPPORTED_LANGUAGES.includes(base) ? base : null;
}

export function resolveLanguage(preference, deviceLocales = []) {
  return normalizeLanguage(preference) || deviceLocales.map(locale =>
    normalizeLanguage(typeof locale === 'string' ? locale : locale.languageTag || locale.languageCode),
  ).find(Boolean) || FALLBACK_LANGUAGE;
}

// A single offline instance is also available before a React tree exists.
const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
  resources,
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  keySeparator: false,
  nsSeparator: false,
  initImmediate: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  returnEmptyString: false,
  react: { useSuspense: false },
});

let language = FALLBACK_LANGUAGE;
let hydration;
let pendingChange;
const listeners = new Set();
const missing = new Set();
const subscribe = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const emit = () => listeners.forEach(listener => listener());
export const getLanguage = () => language;
export const getDirection = () => language === 'ar' ? 'rtl' : 'ltr';

export function translateMessage(value, fallback) {
  if (typeof value === 'string' && i18n.exists(value)) return i18n.t(value);
  return fallback ? i18n.t(fallback) : value;
}

export function t(key, options) {
  if (typeof key !== 'string' || key === '') return '';
  if (__DEV__ && !i18n.exists(key, options) && !missing.has(key)) {
    missing.add(key);
    // Keys contain app-owned copy only; never supply credentials or API payloads as keys.
    console.warn(`[localization] Missing translation: ${key}`);
  }
  return i18n.t(key, options);
}

function deviceLocales() {
  try {
    // Older binaries must still boot; adding the native module requires a new build.
    return require('expo-localization').getLocales();
  } catch {
    return [];
  }
}

export function hydrateLocale() {
  if (!hydration) {
    hydration = (async () => {
      let stored;
      try { stored = await AsyncStorage.getItem(LANGUAGE_KEY); } catch { /* Boot offline/storage locked. */ }
      const next = resolveLanguage(stored, deviceLocales());
      await i18n.changeLanguage(next);
      language = next;
      emit();
      return next;
    })();
  }
  return hydration;
}

/** Persist before publishing. Failed writes leave the current UI and session intact. */
export function setLanguage(value) {
  const next = normalizeLanguage(value);
  if (!next) return Promise.reject(new Error('Unsupported application language'));
  if (pendingChange) return pendingChange;
  pendingChange = (async () => {
    await hydrateLocale();
    await AsyncStorage.setItem(LANGUAGE_KEY, next);
    if (next !== language) {
      await i18n.changeLanguage(next);
      language = next;
      emit();
    }
    return next;
  })().finally(() => { pendingChange = null; });
  return pendingChange;
}

export function useTranslation() {
  const selected = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  // The function changes with language so memoized lists and effects see the update.
  const translate = useCallback((key, options) => t(key, options), [selected]);
  return { t: translate, language: selected, isRTL: selected === 'ar', direction: selected === 'ar' ? 'rtl' : 'ltr' };
}

/** Isolate display-only mixed-script values. Never write this result to storage or APIs. */
export const isolateBidi = value => `\u2068${value ?? ''}\u2069`;

// Gregorian calendar and Latin digits preserve established attendance conventions.
export const getFormattingLocale = () => `${language === 'ar' ? 'ar' : 'en-US'}-u-ca-gregory-nu-latn`;
export function formatDate(value, options = {}) {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB-u-ca-gregory-nu-latn' : getFormattingLocale(), { year: 'numeric', month: 'short', day: 'numeric', ...options }).format(date);
}
export function formatTime(value, options = {}) {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(getFormattingLocale(), { hour: '2-digit', minute: '2-digit', ...options }).format(date);
}
export function formatNumber(value, options = {}) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '';
  return new Intl.NumberFormat(getFormattingLocale(), options).format(Number(value));
}
export function formatCurrency(value, currency = 'SAR', options = {}) {
  return formatNumber(value, { style: 'currency', currency, ...options });
}
export function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return '';
  const minutes = Math.floor(Math.max(0, Number(seconds)) / 60);
  return t('{{hours}}h {{minutes}}m', { hours: formatNumber(Math.floor(minutes / 60)), minutes: formatNumber(minutes % 60) });
}
export function formatList(values, options = {}) {
  return new Intl.ListFormat(language === 'en' ? 'en-GB' : getFormattingLocale(), { style: 'long', type: 'conjunction', ...options }).format(values);
}
export function formatRelativeTime(value, unit = 'day', options = {}) {
  return new Intl.RelativeTimeFormat(getFormattingLocale(), { numeric: 'auto', ...options }).format(value, unit);
}

export default i18n;
