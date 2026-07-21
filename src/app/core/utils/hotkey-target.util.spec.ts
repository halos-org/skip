import { describe, expect, it } from 'vitest';
import { HOTKEY_KEYS, isInteractiveKeyTarget, isBlockingOverlayOpen } from './hotkey-target.util';

function el(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild as HTMLElement;
}

describe('HOTKEY_KEYS', () => {
  it('is the bare key set the app and the injector both key off', () => {
    expect([...HOTKEY_KEYS]).toEqual(['ArrowLeft', 'ArrowRight', 'e', 'f', 'n']);
  });
});

describe('isInteractiveKeyTarget', () => {
  it('suppresses on text-entry controls', () => {
    expect(isInteractiveKeyTarget(el('<input>'))).toBe(true);
    expect(isInteractiveKeyTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isInteractiveKeyTarget(el('<select></select>'))).toBe(true);
    expect(isInteractiveKeyTarget(el('<div contenteditable="true">x</div>'))).toBe(true);
  });

  it('suppresses on arrow-consuming ARIA / Material widgets', () => {
    expect(isInteractiveKeyTarget(el('<div role="listbox"></div>'))).toBe(true);
    expect(isInteractiveKeyTarget(el('<div role="slider"></div>'))).toBe(true);
    expect(isInteractiveKeyTarget(el('<div role="combobox"></div>'))).toBe(true);
    expect(isInteractiveKeyTarget(el('<div role="radiogroup"></div>'))).toBe(true);
    expect(isInteractiveKeyTarget(el('<mat-select></mat-select>'))).toBe(true);
  });

  it('suppresses when focus is nested inside an interactive control', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div role="listbox"><span id="opt">a</span></div>';
    expect(isInteractiveKeyTarget(host.querySelector('#opt'))).toBe(true);
  });

  it('does not suppress on targets that do not consume the hotkeys', () => {
    expect(isInteractiveKeyTarget(el('<div>x</div>'))).toBe(false);
    expect(isInteractiveKeyTarget(el('<button>go</button>'))).toBe(false);
    expect(isInteractiveKeyTarget(document)).toBe(false);
    expect(isInteractiveKeyTarget(null)).toBe(false);
  });
});

describe('isBlockingOverlayOpen', () => {
  it('is true only while a CDK backdrop (dialog / menu / select) is present', () => {
    expect(isBlockingOverlayOpen()).toBe(false);
    const backdrop = document.createElement('div');
    backdrop.className = 'cdk-overlay-backdrop';
    document.body.appendChild(backdrop);
    try {
      expect(isBlockingOverlayOpen()).toBe(true);
    } finally {
      backdrop.remove();
    }
    expect(isBlockingOverlayOpen()).toBe(false);
  });

  it('ignores an overlay pane with no backdrop (snackbar / tooltip)', () => {
    const pane = document.createElement('div');
    pane.className = 'cdk-overlay-pane';
    document.body.appendChild(pane);
    try {
      expect(isBlockingOverlayOpen()).toBe(false);
    } finally {
      pane.remove();
    }
  });
});
