export type LocaleCode = 'en' | 'de';

export const SUPPORTED_LOCALES: { code: LocaleCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
];

export const DEFAULT_LOCALE: LocaleCode = 'en';
export const LANGUAGE_STORAGE_KEY = 'hike.language';

export type MessageTree = { [key: string]: string | MessageTree };

export function isLocaleCode(value: string | null | undefined): value is LocaleCode {
  return value === 'en' || value === 'de';
}

export function lookupMessage(tree: MessageTree, key: string): string | undefined {
  const parts = key.split('.');
  let node: string | MessageTree | undefined = tree;
  for (const part of parts) {
    if (node == null || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] != null ? String(vars[name]) : `{${name}}`,
  );
}
