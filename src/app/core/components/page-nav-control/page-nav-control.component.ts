import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DashboardService } from '../../services/dashboard.service';
import { TileLargeIconComponent } from '../tile-large-icon/tile-large-icon.component';

const DEFAULT_PAGE_ICON = 'dashboard-dashboard';
const PAGE_ICON_SIZE = 28;

/**
 * Persistent page navigator for the toolbar: a row of the pages' own assigned
 * icons, all pages always shown, the active one highlighted. Tapping an icon
 * jumps straight to that page. There is no prev/next — the icons are the
 * targets, sized as large touch targets for gloved/motion use.
 *
 * Navigates by array index via {@link DashboardService.navigateTo}, and
 * reflects programmatic/remote navigation because it reads the same signals.
 */
@Component({
  selector: 'page-nav-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileLargeIconComponent],
  templateUrl: './page-nav-control.component.html',
  styleUrl: './page-nav-control.component.scss',
})
export class PageNavControlComponent {
  private readonly dashboard = inject(DashboardService);

  protected readonly iconSize = PAGE_ICON_SIZE;

  protected readonly pages = computed(() => {
    const dashboards = this.dashboard.dashboards();
    const activeIndex = this.dashboard.activeDashboard();
    return dashboards.map((d, index) => ({
      index,
      active: index === activeIndex,
      svgIcon: d.icon || DEFAULT_PAGE_ICON,
      label: d.name || `Page ${index + 1}`,
    }));
  });

  protected navigateTo(index: number): void {
    this.dashboard.navigateTo(index);
  }
}
