/**
 * User-selectable theme choice. `'system'` follows the OS `prefers-color-scheme`;
 * `'light-theme'` / `'dark-theme'` are explicit. Legacy configs store `''` (dark) —
 * the resolver in AppService treats any non-light, non-system value as dark.
 */
export type ThemeMode = 'system' | 'light-theme' | 'dark-theme';

export const THEME_MODES: readonly { readonly value: ThemeMode; readonly label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light-theme', label: 'Light' },
  { value: 'dark-theme', label: 'Dark' },
];
