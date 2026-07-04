import { Component, inject } from '@angular/core';
import { MatBottomSheetRef, MAT_BOTTOM_SHEET_DATA } from '@angular/material/bottom-sheet';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { ActionMenuItem } from '../action-menu/action-menu-item';

@Component({
  selector: 'widget-host-bottom-sheet',
  standalone: true,
  imports: [ MatListModule, MatIconModule],
  templateUrl: './widget-host-bottom-sheet.component.html',
  styleUrl: './widget-host-bottom-sheet.component.scss'
})
export class WidgetHostBottomSheetComponent {
  private _bottomSheetRef =
    inject<MatBottomSheetRef<WidgetHostBottomSheetComponent>>(MatBottomSheetRef);
  public readonly items: ActionMenuItem[] =
    inject<{ items?: ActionMenuItem[] }>(MAT_BOTTOM_SHEET_DATA)?.items ?? [];

  clickAction(action: string) {
    this._bottomSheetRef.dismiss(action);
  }
}
