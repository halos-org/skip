import { Component, OnInit, inject } from '@angular/core';
import { ChangeDetectionStrategy } from '@angular/core';
import { SsoRedirectService } from '../../core/services/sso-redirect.service';
import { AuthenticationService } from '../../core/services/authentication.service';
import { isEmbeddedInIframe } from '../../core/utils/iframe.util';


@Component({
  selector: 'app-widget-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './widget-login.component.html',
  styleUrls: ['./widget-login.component.css']
})
export class WidgetLoginComponent implements OnInit {
  private ssoRedirect = inject(SsoRedirectService);
  private auth = inject(AuthenticationService);

  public redirecting = false;

  ngOnInit(): void {
    // Reaching /login while already authenticated (bookmark, or an SSO bounce with a live IdP session)
    // must not re-trigger the sign-in redirect, or the bounce returns here and loops indefinitely.
    if (this.auth.loginStatusValue?.status === 'loggedIn') {
      return;
    }
    // Never auto-redirect out of an embedder: manualSignIn() breaks out to window.top when framed,
    // so a framed /login load would frame-bust the host with no user gesture. Leave the panel idle;
    // the auth-blocked recovery's explicit Sign in still breaks out on a click.
    if (isEmbeddedInIframe()) {
      return;
    }
    // Same-origin only: Skip has no credential form. Redirect to the SK/SSO login (explicit sign-in:
    // resets the redirect budget and disables auto-login so this is not immediately auto-bounced).
    this.redirecting = true;
    this.ssoRedirect.manualSignIn();
  }
}
