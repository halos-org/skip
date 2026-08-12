import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';

/**
 * The help menu names its pages by filename, and the viewer fetches them at runtime. A renamed or
 * mistyped entry therefore fails only when a reader opens that page, as an empty panel — nothing in
 * the build or the app notices. Check the two sides against each other here instead.
 */
const HELP_DOCS_DIR = join(cwd(), 'src/assets/help-docs');

interface MenuEntry {
  title: string;
  file?: string;
  items?: MenuEntry[];
}

function collectFiles(entries: MenuEntry[]): string[] {
  return entries.flatMap(entry => [
    ...(entry.file ? [entry.file] : []),
    ...(entry.items ? collectFiles(entry.items) : [])
  ]);
}

describe('help-docs menu.json', () => {
  const menu: MenuEntry[] = JSON.parse(readFileSync(join(HELP_DOCS_DIR, 'menu.json'), 'utf8'));

  it('names a markdown file that exists for every entry', () => {
    const missing = collectFiles(menu).filter(file => !existsSync(join(HELP_DOCS_DIR, file)));
    expect(missing).toEqual([]);
  });
});
