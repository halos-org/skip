import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
// Mark global test flag before anything else so app code can detect test context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__KIP_TEST__ = true;
// Neutralize hard navigation that break Karma connection
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loc: any = window.location;
try {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...loc,
      reload: () => { console.warn('[TEST] location.reload() called'); },
      replace: () => { console.warn('[TEST] location.replace() called'); }
    }
  });
} catch { /* ignore if not allowed */ }

if (!('fonts' in document)) {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      status: 'loaded',
      ready: Promise.resolve(),
      add: () => undefined,
    },
  });
}

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class TestResizeObserver {
    constructor(private readonly callback?: ResizeObserverCallback) {}

    observe(target: Element): void {
      this.callback?.([
        {
          target,
          contentRect: target.getBoundingClientRect?.() ?? new DOMRectReadOnly(0, 0, 0, 0),
        } as ResizeObserverEntry,
      ], this as unknown as ResizeObserver);
    }

    unobserve(): void {}

    disconnect(): void {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
    writable: true,
  });
}

const createCanvasContextStub = (): CanvasRenderingContext2D => {
  const gradient = { addColorStop: () => undefined };
  const baseContext: Record<string, unknown> = {
    save: () => undefined,
    restore: () => undefined,
    scale: () => undefined,
    rotate: () => undefined,
    translate: () => undefined,
    transform: () => undefined,
    setTransform: () => undefined,
    resetTransform: () => undefined,
    clearRect: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
    fillText: () => undefined,
    strokeText: () => undefined,
    drawImage: () => undefined,
    clip: () => undefined,
    setLineDash: () => undefined,
    getLineDash: () => [],
    measureText: (text: string) => ({ width: String(text).length * 8 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(), width: 0, height: 0 }),
    putImageData: () => undefined,
  };

  return new Proxy(baseContext, {
    get(target, prop) {
      if (prop in target) {
        return target[prop as keyof typeof target];
      }

      return () => undefined;
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
};

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => createCanvasContextStub(),
});

Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: () => Promise.resolve(),
});

Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  value: () => undefined,
});
import './test-shims/steelseries-shim';
// Global test configuration (providers, stubs) inlined to avoid module resolution issues.
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { MatDialogRef } from '@angular/material/dialog';
import { MatBottomSheetRef, MAT_BOTTOM_SHEET_DATA } from '@angular/material/bottom-sheet';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ReactiveFormsModule, FormGroupDirective, FormGroup } from '@angular/forms';
// App services/directives are intentionally NOT provided globally: under the @angular/build:unit-test
// runner the setup file's classes are different module instances than the app bundle's, so any
// provider here for an app class is DI-inert (#159). providedIn:'root' services resolve to their real
// instance anyway; a non-root service (like UnitsService) or a fake must be provided locally by the
// spec that needs it. Only framework tokens, env/DOM shims, and icon registration take effect here.
import { ENVIRONMENT_INITIALIZER, inject as diInject, provideZonelessChangeDetection } from '@angular/core';
// Global provider setup (HttpClient, RouterTestingModule, animation & material stubs, etc.)
import { TestBed } from '@angular/core/testing';
import type { Provider } from '@angular/core';

// NOTE: initTestEnvironment is handled by the Angular CLI (@angular/build:unit-test) via its
// internal init-testbed.js setup file. We must NOT call it here to avoid NG0400 platform conflict.

function readTestIconsSvg(): string {
  const basePath = cwd() || process.cwd() || '.';
  return readFileSync(join(basePath, 'src/assets/svg/icons.svg'), 'utf-8');
}

// Note: Icon sprite registration happens in ENVIRONMENT_INITIALIZER and/or per-spec helper.
// Note: Keep logs strict, but apply a very narrow filter for known MatIcon noise only.
// Test-only console.error filter: hide the specific MatIconRegistry noise for ':dashboard-dashboard'
// without suppressing other errors. This avoids distracting lines when suites run in groups.
(() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origError = (console.error as any).bind(console);
    // Match only the MatIcon failure format that includes a leading-colon icon name (empty namespace)
    // Examples seen: (a) "Error retrieving icon :dashboard-dashboard! ..."
    //                (b) ['ERROR', Error('Error retrieving icon :troubleshoot! ...'), ...]
    //                (c) other icons like ':remote-control'
    const colonMatIconMsg = /^Error retrieving icon\s*:[A-Za-z0-9_-]+\b/i;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console.error as any) = (...args: any[]) => {
      try {
        const first = args?.[0];
        const second = args?.[1];
        // Case (a): first arg is the string message
  if (typeof first === 'string' && colonMatIconMsg.test(first)) return;
        // Case (b): first arg is 'ERROR' and second is an Error with the message
  if (first === 'ERROR' && second instanceof Error && typeof second.message === 'string' && colonMatIconMsg.test(second.message)) return;
      } catch { /* fall through to original */ }
      return origError(...args);
    };
  } catch { /* ignore */ }
})();
class MatBottomSheetRefStub { dismiss(): void { /* noop */ } }
class MatDialogRefStub { close(): void { /* noop */ } }
// ActivatedRoute stub must expose observable params/queryParams for components piping them
const ActivatedRouteStub = {
  snapshot: { params: {}, queryParams: {} },
  params: new BehaviorSubject<Record<string, unknown>>({}),
  queryParams: new BehaviorSubject<Record<string, unknown>>({})
} as unknown as Partial<ActivatedRoute>;

// Monkey-patch TestBed to always merge in our global imports/providers for every spec
const GLOBAL_IMPORTS = [RouterTestingModule, ReactiveFormsModule, MatIconModule];
type GlobalProvider = Provider | import('@angular/core').EnvironmentProviders;
const GLOBAL_PROVIDERS: GlobalProvider[] = [
  provideZonelessChangeDetection(),
  {
    provide: ENVIRONMENT_INITIALIZER,
    multi: true,
    useValue: () => {
      try {
        // No debug wrapper around MatIconRegistry in tests.
        // Ensure we only register once across multiple configureTestingModule calls
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w2 = window as any;
        if (w2.__KIP_ICONS_REGISTERED__) return;
        const iconRegistry = diInject(MatIconRegistry);
        const sanitizer = diInject(DomSanitizer);
        const iconSvg = readTestIconsSvg();
        if (typeof iconSvg === 'string' && iconSvg.length > 0) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(iconSvg, 'image/svg+xml');
          // Register the whole set in supported namespaces (default and 'kip')
          const trusted = sanitizer.bypassSecurityTrustHtml(iconSvg);
          // Default (no namespace, svgIcon="name")
          iconRegistry.addSvgIconSetLiteral(trusted);
          // App-level namespace commonly used in KIP (svgIcon="kip:name")
          iconRegistry.addSvgIconSetInNamespace('kip', trusted);
          const svgs = Array.from(doc.querySelectorAll('svg[id]')) as SVGSVGElement[];
          for (const svg of svgs) {
            const id = svg.getAttribute('id');
            if (!id) continue;
            iconRegistry.addSvgIconLiteral(id, sanitizer.bypassSecurityTrustHtml(svg.outerHTML));
          }
          // Mark as registered to avoid rework in subsequent modules
          w2.__KIP_ICONS_REGISTERED__ = true;
        } else {
          console.error('[TEST BOOTSTRAP] Failed to load src/assets/svg/icons.svg. SVG icon ids will not be validated.');
        }
      } catch (err) {
        console.error('[TEST BOOTSTRAP] Error while registering SVG icons for tests:', err);
      }
    }
  },
  provideHttpClient(withInterceptorsFromDi()),
  provideHttpClientTesting(),
  provideNoopAnimations(),
  { provide: MAT_DIALOG_DATA, useValue: {} },
  { provide: MatBottomSheetRef, useClass: MatBottomSheetRefStub },
  { provide: MatDialogRef, useClass: MatDialogRefStub },
  { provide: MAT_BOTTOM_SHEET_DATA, useValue: {} },
  { provide: ActivatedRoute, useValue: ActivatedRouteStub },
  { provide: FormGroupDirective, useValue: { control: new FormGroup({}) } as Partial<FormGroupDirective> }
];

interface PartialTestingModule { imports?: unknown[]; providers?: unknown[] }
const tbPatched = TestBed as unknown as { configureTestingModule: (moduleDef: PartialTestingModule) => unknown };
const _origConfigure = tbPatched.configureTestingModule.bind(TestBed);
tbPatched.configureTestingModule = (moduleDef: PartialTestingModule = {}) => {
  moduleDef.imports = [...(moduleDef.imports ?? []), ...GLOBAL_IMPORTS];
  // Prepend globals so spec-local providers can override by later entries.
  moduleDef.providers = [...GLOBAL_PROVIDERS, ...(moduleDef.providers ?? [])];
  return _origConfigure(moduleDef);
};

// Angular CLI will find and run specs automatically (FindTestsPlugin). No manual __karma__.start().
console.log('[TEST BOOTSTRAP] Global test environment configured. Waiting for spec auto-discovery...');
