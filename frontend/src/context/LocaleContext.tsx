import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  LANGUAGE_STORAGE_KEY,
  interpolate,
  isLocaleCode,
  lookupMessage,
  type LocaleCode,
  type MessageTree,
} from '../i18n';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';

const catalogs: Record<LocaleCode, MessageTree> = {
  en: en as MessageTree,
  de: de as MessageTree,
};

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

interface LocaleContextType {
  language: LocaleCode;
  setLanguage: (code: LocaleCode) => void;
  t: TranslateFn;
}

const LocaleContext = createContext<LocaleContextType | null>(null);

function readStoredLanguage(): LocaleCode {
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLocaleCode(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LocaleCode>(readStoredLanguage);

  const setLanguage = useCallback((code: LocaleCode) => {
    setLanguageState(code);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback<TranslateFn>(
    (key, vars) => {
      const fromActive = lookupMessage(catalogs[language], key);
      const fromEn = lookupMessage(catalogs.en, key);
      const template = fromActive ?? fromEn ?? key;
      return interpolate(template, vars);
    },
    [language],
  );

  const value = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
