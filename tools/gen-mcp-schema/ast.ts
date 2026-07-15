/**
 * Small helpers for reading static literals out of KIP source with the
 * TypeScript Compiler API.
 *
 * KIP already depends on `typescript`, so the generator uses the compiler API
 * directly (no extra dependency). We only ever parse syntactically and read
 * literal values — Angular components are never executed.
 */
import * as fs from 'node:fs';
import * as ts from 'typescript';

/** Parses a source file syntactically (no type-checking, no program). */
export function parseSourceFile(filePath: string): ts.SourceFile {
  const content = fs.readFileSync(filePath, 'utf8');
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, /* setParentNodes */ true);
}

/** Maps a same-file identifier to the initializer it was declared with, if any. */
export type IdentifierResolver = (name: string) => ts.Expression | undefined;

/**
 * Converts a literal expression node to a plain JS value.
 *
 * Supports strings, numbers (incl. unary minus), booleans, null, arrays and
 * object literals. The `undefined` identifier maps to the unset value (its key
 * drops out of the emitted JSON), and — when a resolver is supplied — an
 * identifier naming a same-file module constant is resolved one hop to its
 * literal. Anything else (an unresolvable identifier, function call, spread,
 * computed value, ...) throws: the generator fails loudly rather than emitting
 * a wrong default.
 */
export function literalToValue(node: ts.Expression, resolveIdentifier?: IdentifierResolver): unknown {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);

  switch (node.kind) {
    case ts.SyntaxKind.TrueKeyword:
      return true;
    case ts.SyntaxKind.FalseKeyword:
      return false;
    case ts.SyntaxKind.NullKeyword:
      return null;
  }

  if (ts.isIdentifier(node)) {
    // `undefined` parses as an identifier, not a keyword. Treat only that exact
    // identifier as the unset value (object keys valued `undefined` drop out of
    // the JSON artifact).
    if (node.text === 'undefined') return undefined;
    // A reference to a module-scope `const NAME = <literal>` in the same file is
    // still a static literal, one hop away — resolve it. Any identifier the
    // resolver can't map to a literal falls through to the loud throw below.
    const declared = resolveIdentifier?.(node.text);
    if (declared) return literalToValue(declared, resolveIdentifier);
  }

  if (ts.isParenthesizedExpression(node)) {
    return literalToValue(node.expression, resolveIdentifier);
  }

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = literalToValue(node.operand, resolveIdentifier);
    if (typeof inner === 'number') return -inner;
    throw unsupported(node);
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => literalToValue(element, resolveIdentifier));
  }

  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, unknown> = {};
    for (const member of node.properties) {
      if (!ts.isPropertyAssignment(member)) throw unsupported(member);
      obj[propertyName(member.name)] = literalToValue(member.initializer, resolveIdentifier);
    }
    return obj;
  }

  throw unsupported(node);
}

/**
 * Builds an identifier resolver over a source file's module-scope variable
 * declarations, mapping each name to its initializer expression. Lets
 * `literalToValue` resolve a DEFAULT_CONFIG value that references a same-file
 * constant (e.g. `windSectorWindowSeconds: DEFAULT_WINDOW_SECONDS`) back to its
 * literal. Only top-level declarations are collected, so function-local names
 * never shadow the lookup.
 */
export function collectModuleConstants(sourceFile: ts.SourceFile): IdentifierResolver {
  const byName = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    // Only `const` — a `let`/`var` binding could be reassigned, so its initializer
    // is not a reliable static value.
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer && !byName.has(declaration.name.text)) {
        byName.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return (name) => byName.get(name);
}

function propertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  throw new Error(`Unsupported property name kind: ${ts.SyntaxKind[name.kind]}`);
}

function unsupported(node: ts.Node): Error {
  return new Error(
    `Unsupported (non-literal) syntax: ${ts.SyntaxKind[node.kind]}. ` +
      `The MCP schema generator only reads static literals.`,
  );
}

/**
 * Finds the first property/variable named `propName` whose initializer is an
 * array literal, anywhere in the source file. Throws if not found.
 */
export function findArrayLiteral(sourceFile: ts.SourceFile, propName: string): ts.ArrayLiteralExpression {
  let found: ts.ArrayLiteralExpression | undefined;

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isPropertyDeclaration(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isVariableDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === propName &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (!found) {
    throw new Error(`Could not find an array initializer named "${propName}" in ${sourceFile.fileName}`);
  }
  return found;
}

/**
 * Returns the initializer expression of the first property/variable named
 * `propName`, regardless of its kind (object, call, array, ...). Throws if not found.
 */
export function findPropertyInitializer(sourceFile: ts.SourceFile, propName: string): ts.Expression {
  let result: ts.Expression | undefined;

  const visit = (node: ts.Node): void => {
    if (result) return;
    if (
      (ts.isPropertyDeclaration(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isVariableDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === propName &&
      node.initializer
    ) {
      result = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (!result) {
    throw new Error(`Could not find an initializer named "${propName}" in ${sourceFile.fileName}`);
  }
  return result;
}

/**
 * Maps an object literal's property assignments to name -> initializer. Skips
 * spreads, shorthand and methods. Lets callers read only the literal keys they
 * care about, tolerating non-literal siblings.
 */
export function getObjectProperties(node: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const props = new Map<string, ts.Expression>();
  for (const member of node.properties) {
    if (
      ts.isPropertyAssignment(member) &&
      (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name))
    ) {
      props.set(member.name.text, member.initializer);
    }
  }
  return props;
}

/**
 * Returns the module specifier of the lazy-loader entry that resolves
 * `componentClassName`.
 *
 * Widget components are never imported statically; `widget.service.ts` loads each
 * through its `_componentTypeMap` as
 * `ComponentClassName: () => import('SPECIFIER').then(m => m.ComponentClassName)`.
 * This finds the dynamic `import('SPECIFIER')` whose `.then` callback returns
 * `<param>.componentClassName`, tying the specifier to the actual exported class.
 * Throws if no such loader entry is found.
 */
export function findLazyLoadedModuleSpecifier(
  sourceFile: ts.SourceFile,
  componentClassName: string,
): string {
  let specifier: string | undefined;

  const visit = (node: ts.Node): void => {
    if (specifier !== undefined) return;
    const found = lazyLoaderSpecifier(node, componentClassName);
    if (found !== undefined) {
      specifier = found;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (specifier === undefined) {
    throw new Error(
      `Could not find a lazy-loader entry for "${componentClassName}" in ${sourceFile.fileName}`,
    );
  }
  return specifier;
}

/**
 * If `node` is `import('SPECIFIER').then(param => param.componentClassName)`,
 * returns SPECIFIER; otherwise undefined.
 */
function lazyLoaderSpecifier(node: ts.Node, componentClassName: string): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;

  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'then') return undefined;

  const importCall = callee.expression;
  if (
    !ts.isCallExpression(importCall) ||
    importCall.expression.kind !== ts.SyntaxKind.ImportKeyword
  ) {
    return undefined;
  }

  const moduleArg = importCall.arguments[0];
  if (!moduleArg || !ts.isStringLiteralLike(moduleArg)) return undefined;

  const callback = node.arguments[0];
  if (!callback || !returnsMember(callback, componentClassName)) return undefined;

  return moduleArg.text;
}

/** True when `fn` is an arrow `param => param.memberName` (concise or single-return body). */
function returnsMember(fn: ts.Expression, memberName: string): boolean {
  if (!ts.isArrowFunction(fn)) return false;
  const returned = ts.isBlock(fn.body) ? singleReturnExpression(fn.body) : fn.body;
  return !!returned && ts.isPropertyAccessExpression(returned) && returned.name.text === memberName;
}

function singleReturnExpression(block: ts.Block): ts.Expression | undefined {
  const [statement] = block.statements;
  return block.statements.length === 1 && statement && ts.isReturnStatement(statement)
    ? statement.expression
    : undefined;
}

/**
 * Returns the initializer expression of a class's `static` property, e.g. a
 * widget component's `static readonly DEFAULT_CONFIG = { ... }`. Throws if the
 * class or the static property is not found.
 */
export function findStaticPropertyInitializer(
  sourceFile: ts.SourceFile,
  className: string,
  propName: string,
): ts.Expression {
  let initializer: ts.Expression | undefined;

  const visit = (node: ts.Node): void => {
    if (initializer) return;
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      for (const member of node.members) {
        if (
          ts.isPropertyDeclaration(member) &&
          ts.isIdentifier(member.name) &&
          member.name.text === propName &&
          member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) &&
          member.initializer
        ) {
          initializer = member.initializer;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (!initializer) {
    throw new Error(`Could not find static "${propName}" on class "${className}" in ${sourceFile.fileName}`);
  }
  return initializer;
}
