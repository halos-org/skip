import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatIconModule } from '@angular/material/icon';
import { BreakpointObserver } from '@angular/cdk/layout';
import { WidgetHostBottomSheetComponent } from '../widget-host-bottom-sheet/widget-host-bottom-sheet.component';
import { ActionMenuItem } from './action-menu-item';

/** Below this width the menu is a bottom drawer; above it, a pop-over at the tap point. */
const PHONE_QUERY = '(max-width: 599.98px)';

/**
 * Responsive action menu. Embed it once in a host and call {@link open} with the
 * tap coordinates: on phones it slides up as a bottom drawer, on larger screens
 * it opens as a Material menu anchored at the tap point. Emits the chosen item id
 * via {@link selected} (a plain Cancel/backdrop dismissal emits nothing).
 */
@Component({
  selector: 'action-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatMenuModule, MatIconModule],
  templateUrl: './action-menu.component.html',
  styleUrl: './action-menu.component.scss',
})
export class ActionMenuComponent {
  public readonly items = input<ActionMenuItem[]>([]);
  public readonly selected = output<string>();

  private readonly _breakpoint = inject(BreakpointObserver);
  private readonly _bottomSheet = inject(MatBottomSheet);
  private readonly _anchor = viewChild.required<ElementRef<HTMLElement>>('anchor');
  private readonly _trigger = viewChild.required(MatMenuTrigger);

  public open(x: number, y: number): void {
    if (this._breakpoint.isMatched(PHONE_QUERY)) {
      // A long-press opens this sheet; the same gesture's trailing tap/click ghost-hits the backdrop
      // and immediately dismisses it on touch devices (first seen on Linux Firefox, but real mobile
      // browsers do it too — the drawer vanishes the instant it opens). Disable backdrop-close on the
      // phone path; the always-present Cancel row is the exit.
      this._bottomSheet.open(WidgetHostBottomSheetComponent, {
        data: { items: this.items() },
        disableClose: true,
      })
        .afterDismissed()
        .subscribe((id?: string) => {
          if (id && id !== 'cancel') this.selected.emit(id);
        });
      return;
    }
    const el = this._anchor().nativeElement;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    // A transformed ancestor becomes the containing block for this fixed anchor, so left/top
    // resolve against that box instead of the viewport and the pop-over lands off the tap point.
    // (The bottom-sheet container keeps a residual transform matrix from its forwards-filled
    // enter animation, so its box — centred and offset on wide screens — is the reference.)
    // Measure the offset the containing block introduces and cancel it; a no-op when there is none.
    const rect = el.getBoundingClientRect();
    const offsetX = rect.left - x;
    const offsetY = rect.top - y;
    el.style.left = `${x - offsetX}px`;
    el.style.top = `${y - offsetY}px`;
    this._trigger().openMenu();
  }

  protected onSelect(id: string): void {
    this._trigger().closeMenu();
    this.selected.emit(id);
  }
}
