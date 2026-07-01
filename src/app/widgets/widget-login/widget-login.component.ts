import { Component, OnInit, inject } from '@angular/core';
import { ChangeDetectionStrategy } from '@angular/core';
import { SsoRedirectService } from '../../core/services/sso-redirect.service';


@Component({
  selector: 'app-widget-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './widget-login.component.html',
  styleUrls: ['./widget-login.component.css']
})
export class WidgetLoginComponent implements OnInit {
  private ssoRedirect = inject(SsoRedirectService);

  public redirecting = false;

  ngOnInit(): void {
    // Same-origin only: SKip has no credential form. Redirect to the SK/SSO login (explicit sign-in:
    // resets the redirect budget and disables auto-login so this is not immediately auto-bounced).
    this.redirecting = true;
    this.ssoRedirect.manualSignIn();
  }
}
