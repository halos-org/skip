import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `--skip-contrast-color` is the ink that contrasts with a surface. Used as a `background-color` it
 * pairs a theme's foreground against that same foreground: the light theme resolves it to #000000,
 * so the element renders black on black and its text disappears. That shipped once, in the Racer
 * Timer's start-time field. jsdom resolves neither `var()` nor themes, so guard the source instead.
 */
const scssFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { return scssFiles(path); }
    return path.endsWith('.scss') ? [path] : [];
  });

describe('contrast token usage', () => {
  it('never uses the contrast ink as a background', () => {
    const files = scssFiles('src');
    // Without this the scan can silently find nothing and the test passes on an empty list.
    expect(files.length, 'no SCSS files scanned — is the working directory the repo root?')
      .toBeGreaterThan(20);

    const offenders = files.flatMap(path => readFileSync(path, 'utf8').split('\n')
      .map((text, i) => ({ where: `${path}:${i + 1}`, text: text.trim() }))
      .filter(({ text }) =>
        /background(-color)?\s*:/.test(text) && text.includes('--skip-contrast-color'))
      .map(({ where }) => where));

    expect(offenders).toEqual([]);
  });
});
