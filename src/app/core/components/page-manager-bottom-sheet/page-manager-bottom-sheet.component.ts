import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DashboardsEditorComponent } from '../dashboards-editor/dashboards-editor.component';

/**
 * Bottom-sheet host for page management in edit mode. Presents the page ops —
 * add / drag-reorder / rename / duplicate / delete — as a vertical, scrollable
 * list suited to a phone-sized touch display. The management logic itself lives
 * in {@link DashboardsEditorComponent}.
 */
@Component({
  selector: 'page-manager-bottom-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, DashboardsEditorComponent],
  templateUrl: './page-manager-bottom-sheet.component.html',
  styleUrl: './page-manager-bottom-sheet.component.scss',
})
export class PageManagerBottomSheetComponent {
  private readonly _bottomSheetRef =
    inject<MatBottomSheetRef<PageManagerBottomSheetComponent>>(MatBottomSheetRef);

  protected close(): void {
    this._bottomSheetRef.dismiss();
  }
}
