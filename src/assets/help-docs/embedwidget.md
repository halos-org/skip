## Using the Embed Page Viewer Widget

The Embed Page Viewer widget allows you to display external web pages or web applications directly within your dashboard. By default, the Embed Page Viewer widget does not allow input (touch, mouse and keyboard interactions) with the content in the Embed. To enable interactions, check the setting in the widget's options.

While this embedding feature is powerful, it comes with certain limitations due to browser security policies — specifically, whether the embedded site permits being shown in an iframe, and whether it shares the same origin as Skip. This guide explains these limitations in simple terms and how they might affect your use of the widget.

## Why Some Pages Won't Embed

Whether a page can be shown inside an iframe is decided by **the page you are embedding**, not by Skip or Signal K. A site controls this with the `X-Frame-Options` HTTP header or a `Content-Security-Policy: frame-ancestors` directive. If the site forbids framing (many banking, social-media, and login sites do), the browser blocks it and you see a blank area or an error. Nothing the widget does can bypass it — the site owner has to allow it (see "Authorizing Skip to Load Embedded Content" below).

> This is a different mechanism from CORS. CORS governs cross-origin *data* requests (fetch/XHR); it does not decide whether a page can be framed.

## Same-Origin Content and Gestures

A second browser rule matters here: the **same-origin policy**. When you turn on **Enable Input**, Skip injects small gestures into the embedded page so you can still swipe to change pages or reveal the auto-hiding toolbar over a full-screen embed. The browser only lets Skip script the iframe when the embedded content is **same-origin** — the same protocol, hostname, and port as the Skip dashboard. An origin is that combination of protocol (e.g. `http` or `https`), hostname (e.g. `localhost` or `example.com`), and optional port (e.g. `80`, `443`, or a custom port); the path after the port doesn't matter.

### When Content Is Same-Origin

If the URL you embed uses the same protocol, hostname, and port as your Skip dashboard (e.g. any Signal K app-store application served by your own server), the browser treats it as same-origin: Skip's gestures work over it, and framing is not an issue.

#### Examples:

1. **Same Origin**:
   - Skip Dashboard URL: `http://localhost:3000/@halos-org/skip/`
   - Embedded Content URL: `http://localhost:3000/some-page/`
   - Both share the same protocol (`http`), hostname (`localhost`), and port (`3000`), so this is same-origin — Skip's gestures work over it.

2. **Different Origin (cross-origin)**:
   - Skip Dashboard URL: `http://localhost:3000/@halos-org/skip/`
   - Embedded Content URL: `http://localhost:4000/some-page/`
   - The ports differ (`3000` vs. `4000`), so the browser treats them as different origins: Skip can't inject gestures, and whether the page frames at all is up to its own policy.

3. **Different Hostname (cross-origin)**:
   - Skip Dashboard URL: `http://dashboard.local/@halos-org/skip/`
   - Embedded Content URL: `http://example.com/some-page`
   - Even with the same port, the hostnames differ (`dashboard.local` vs. `example.com`), so this is cross-origin.

4. **Different Protocol (cross-origin)**:
   - Skip Dashboard URL: `http://localhost:3000/@halos-org/skip/`
   - Embedded Content URL: `https://localhost:3000/some-page/`
   - Even with the same hostname and port, the protocols differ (`http` vs. `https`), so this is cross-origin.

### IMPORTANT:  Practical Implications for Skip Users

- Embedding webapps and websites is far from perfect. There are tradeoffs and limitations. If you find yourself unhappy with the result, keep your smile and give back to the community by building a dedicated Skip widget. We will help and many have done so.
- By default you cannot interact with the Embed content. Activate the **Enable Input** widget option if you need to interact with the content.
- If you are hosting custom web pages or applications on the same server as your Skip dashboard, ideally you've created a Signal K webapp and shared it with the community, ensure they use the same hostname and port. Use a relative URL path in the Embed configuration. For example, if your Skip dashboard is running on `http://localhost:3000/@halos-org/skip/` and your custom content is under the same origin, such as `http://localhost:3000/signalk-anchoralarm-plugin/` simply enter a relative URL in the widget options, like `/signalk-anchoralarm-plugin/`. Skip will automatically add the proper protocol, hostname, port and load the content. This will prevent issues loading the embedded content when launching Skip from different devices such as: the server, on your phone, tablet, laptop, etc.

### Summary

Two independent rules apply: the embedded site's framing policy (`X-Frame-Options` / `frame-ancestors`) decides whether it can be shown at all, and the same-origin policy decides whether Skip can inject gestures over it. Hosting your embedded content at the same origin as the dashboard avoids the second problem entirely and lets you use the Embed Page Viewer widget seamlessly.

## How Does This Affect the Embed Widget?

1. **Blocked Content**:
   - If the website you are trying to embed forbids framing (via `X-Frame-Options` or a `frame-ancestors` policy), the widget will not display the content. Instead, you might see a blank area or an error message.

2. **Common Examples of Blocked Content**:
   - Many popular websites (e.g., banking sites, social media platforms, or secure portals) block iframe embedding for security reasons.
   - Some websites may allow embedding only for specific trusted domains, which most probably, do not include your Signal K installation.

3. **Consequences of Cross-Origin Content in Skip**:
   - When you enable the "Enable Input" Embed widget option, Skip needs to inject gestures within the embedded application to trigger page navigation or reveal the auto-hiding toolbar. To do this, Skip scripts the iframe. The same-origin policy only permits this for same-origin content, so over a **cross-origin** embed the gestures will not work. If you have a full-screen cross-origin Embed widget, you could get stuck with no way to change pages or reveal the toolbar.

4. **No Workaround for Restricted Websites**:
   - If the application does not allow iframe embedding, there is no way to bypass this restriction without the application owner's adding some kind of authorization for you. This is a browser-enforced security feature.

## How to Use the Embed Widget Effectively

1. **Choose Embed-Friendly Websites**:
   - Use URLs from applications and sites that allow embedding in iframes. For example, all Signal K webapps, Grafana, many public information sites, weather services, or custom web pages you control are good candidates.

2. **Check with the Application Owner**:
   - If you need to embed a specific app, contact the app owner see if they provide a mechanism to add allowed host URL to their app.

## Authorizing Skip to Load Embedded Content

When using the Embed Page Viewer widget, it is important to understand that the ability to display a website or app inside the widget depends on the website or app itself. Specifically, the website being embedded must explicitly allow YOUR PERSONAL SIGNAL K SERVER to load its app or content in an iframe. This can be configured by the embedded app's security settings, which are typically configured using HTTP headers in configuration files.

### What App and Site Owners Need to Do

1. **Allow Embedding in an iframe**:
   - The website must include the `X-Frame-Options` HTTP header or the `Content-Security-Policy` header to explicitly allow embedding.
   - For example:
     - To allow embedding from any domain:
       ```http
       Content-Security-Policy: frame-ancestors *
       ```
     - To allow embedding only from the Skip dashboard (replace `your-signalk-domain.com` with your actual domain):
       ```http
       Content-Security-Policy: frame-ancestors http://your-signalk-domain.com:3000
       ```

2. **Test the Configuration**:
   - After updating the HTTP headers, test the website in the Embed Page Viewer widget. To ensure it loads correctly, look in the browser's console log for error messages.
