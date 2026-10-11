import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import type { ISiScaleReset } from '../../interfaces/app-settings.interfaces';

interface IResetDashboard {
  dashboardId: string;
  dashboard: string;
  widgets: string[];
}

/** Lists the widgets whose scale range the SI migration reset. Closes true when the user dismisses the list for good. */
@Component({
  selector: 'dialog-si-scale-resets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatDialogModule, MatButtonModule],
  templateUrl: './dialog-si-scale-resets.component.html',
  styleUrl: './dialog-si-scale-resets.component.scss'
})
export class DialogSiScaleResetsComponent {
  private readonly resets = inject<ISiScaleReset[]>(MAT_DIALOG_DATA);
  protected readonly dashboards: IResetDashboard[] = groupByDashboard(this.resets);
}

function groupByDashboard(resets: ISiScaleReset[]): IResetDashboard[] {
  const groups = new Map<string, IResetDashboard>();
  for (const reset of resets) {
    const group = groups.get(reset.dashboardId) ?? { dashboardId: reset.dashboardId, dashboard: reset.dashboard, widgets: [] };
    group.widgets.push(reset.widget);
    groups.set(reset.dashboardId, group);
  }
  return Array.from(groups.values());
}
