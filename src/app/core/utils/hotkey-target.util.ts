/**
 * The bare keys the app's global hotkey listener acts on, in `KeyboardEvent.key`
 * form: page nav (←/→) and e/f/n (edit/fullscreen/night). Single source for the
 * global shell hotkeys — the listener lowercases these to match its normalized
 * filter. Esc-cancels-edit is deliberately NOT here: it is component-local and
 * registered separately in dashboard.component.ts.
 */
export const HOTKEY_KEYS = ['ArrowLeft', 'ArrowRight', 'e', 'f', 'n'] as const;

/**
 * Controls that legitimately consume the hotkeys' keystrokes: text entry and the
 * arrow-navigating ARIA / Material widgets. A focused one means a bare hotkey
 * must yield rather than fire.
 */
const INTERACTIVE_TARGET_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"],' +
  ' [role="textbox"], [role="searchbox"], [role="combobox"], [role="listbox"],' +
  ' [role="option"], [role="menu"], [role="menuitem"], [role="slider"],' +
  ' [role="spinbutton"], [role="radiogroup"], [role="radio"], [role="tab"],' +
  ' [role="tablist"], mat-select, mat-slider';

/**
 * True when a key event targets a control that legitimately consumes the
 * keystroke, so a bare-key hotkey must yield rather than fire. Covers text entry
 * (so typing "n" never toggles night mode) and arrow-navigating widgets (so
 * arrows adjust a focused slider / select instead of paging the dashboard).
 */
export function isInteractiveKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if ((target as HTMLElement).isContentEditable) return true;
  return target.closest(INTERACTIVE_TARGET_SELECTOR) !== null;
}

/**
 * True while a modal overlay that owns the keyboard is open — a dialog, menu, or
 * select, all of which render a CDK backdrop. Snackbars/toasts and tooltips have
 * no backdrop and are excluded. Bare hotkeys must not drive the app behind such
 * an overlay, and Esc must yield to it (its own Escape closes it first).
 */
export function isBlockingOverlayOpen(): boolean {
  return document.querySelector('.cdk-overlay-backdrop') !== null;
}
