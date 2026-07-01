import { Injectable } from '@angular/core';
import { HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http'

@Injectable()
export class AuthenticationInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler) {
    // Same-origin only: the httpOnly session cookie carries auth, so send credentials on same-origin
    // requests and never attach a header. A cross-origin request (not part of the supported topology)
    // gets neither — the cookie cannot flow cross-origin.
    return next.handle(this.isSameOrigin(req.url) ? req.clone({ withCredentials: true }) : req.clone());
  }

  private isSameOrigin(url: string): boolean {
    try {
      // Relative URLs resolve against the app origin.
      return new URL(url, window.location.origin).origin === window.location.origin;
    } catch {
      return false;
    }
  }
}
