import * as ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { collectModuleConstants, findLazyLoadedModuleSpecifier, findPropertyInitializer, literalToValue } from './ast';

function sourceOf(code: string): ts.SourceFile {
  return ts.createSourceFile('inline.ts', code, ts.ScriptTarget.Latest, /* setParentNodes */ true);
}

describe('literalToValue', () => {
  it('maps the `undefined` identifier to the unset value so its key drops from the JSON', () => {
    const value = literalToValue(findPropertyInitializer(sourceOf('const c = { a: 1, b: undefined };'), 'c')) as Record<
      string,
      unknown
    >;
    expect('b' in value).toBe(true);
    expect(value.b).toBeUndefined();
    expect(JSON.stringify(value)).toBe('{"a":1}');
  });

  it('resolves a same-file module constant one hop to its literal', () => {
    const src = sourceOf('const N = 5;\nconst c = { period: N };');
    const value = literalToValue(findPropertyInitializer(src, 'c'), collectModuleConstants(src)) as Record<
      string,
      unknown
    >;
    expect(value.period).toBe(5);
  });

  it('throws (fail-loud) on an identifier it cannot resolve to a literal', () => {
    const src = sourceOf('const c = { x: SOME_ENUM_MEMBER };');
    expect(() => literalToValue(findPropertyInitializer(src, 'c'), collectModuleConstants(src))).toThrow(/non-literal/i);
  });
});

describe('collectModuleConstants', () => {
  it('resolves a top-level const but ignores let/var (their initializer is not a reliable static value)', () => {
    const resolve = collectModuleConstants(sourceOf('const A = 1;\nlet B = 2;\nvar C = 3;'));
    const a = resolve('A');
    expect(a).toBeDefined();
    expect(literalToValue(a as ts.Expression)).toBe(1);
    expect(resolve('B')).toBeUndefined();
    expect(resolve('C')).toBeUndefined();
  });
});

describe('findLazyLoadedModuleSpecifier', () => {
  const loaderMap =
    'const _componentTypeMap = {\n' +
    "  WidgetNumericComponent: () => import('../../widgets/widget-numeric/widget-numeric.component').then(m => m.WidgetNumericComponent),\n" +
    "  WidgetAcComponent: () => import('../../widgets/widget-ac/widget-ac.component').then(m => m.WidgetAcComponent),\n" +
    '};';

  it('resolves the module specifier tied to the exported class via the .then callback', () => {
    expect(findLazyLoadedModuleSpecifier(sourceOf(loaderMap), 'WidgetAcComponent')).toBe(
      '../../widgets/widget-ac/widget-ac.component',
    );
  });

  it('throws when no loader entry names the class', () => {
    expect(() => findLazyLoadedModuleSpecifier(sourceOf(loaderMap), 'WidgetMissingComponent')).toThrow(
      /lazy-loader entry/i,
    );
  });
});
