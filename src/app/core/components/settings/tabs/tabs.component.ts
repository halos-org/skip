import { Component } from '@angular/core';
import { SettingsNotificationsComponent } from '../notifications/notifications.component';
import { SettingsDisplayComponent } from '../display/display.component';
import { MatTabGroup, MatTab } from '@angular/material/tabs';
import { PageHeaderComponent } from '../../page-header/page-header.component';
import { SettingsConfigComponent } from '../configuration/config.component';

@Component({
    selector: 'tabs',
    templateUrl: './tabs.component.html',
    styleUrls: ['./tabs.component.scss'],
    imports: [
      MatTabGroup,
      MatTab,
      SettingsNotificationsComponent,
      SettingsDisplayComponent,
      SettingsNotificationsComponent,
      SettingsConfigComponent,
      PageHeaderComponent
  ]
})
export class TabsComponent {
  protected readonly pageTitle: string = "Settings";
  constructor() { }
}
