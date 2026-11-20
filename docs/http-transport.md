# HTTP transport and browser fallback

With `transport: 'http'`, a session talks to Shufersal over plain HTTP from
Node. It opens a browser only when it needs one. If Shufersal ever starts
blocking plain HTTP, the session switches to the browser on its own, so nothing
breaks while we look into it.

The default is still `transport: 'browser'`, so callers built on the old API
(overriding `initSession`, reading `session.browserPage`) keep working until
they opt in. Once Salchik has moved over, `http` becomes the default and
`initSession`, `browserPage` and `browserContext` go away.

## What runs where

- Reads (search, products, orders, cart, time slots, promotions): HTTP.
- Writes (cart changes, picking a time slot, update mode, receipts): HTTP.
- Logging in: browser, because it types into the login form.
- Placing an order: browser, because the 3D Secure step runs PayMe's script.
- Anything after HTTP was blocked: browser, for the rest of that session.

A session restored from saved cookies makes no request until the first call. It
does not load a page to check the login. If Shufersal redirects a call to the
login page, the session logs in through the browser, copies the new cookies
back, and retries the call over HTTP.

## How the HTTP requests look

- Cookies come from the saved session (the same cookie objects puppeteer
  returns) and are kept in a cookie jar. Every `Set-Cookie` updates the jar, and
  `serialize()` returns the jar, so saved sessions keep working in either mode.
- Every request sends a desktop Chrome `User-Agent`. Shufersal accepted the
  default Node one in testing, but this keeps us looking like a browser if they
  start checking.
- Redirects are followed by hand so cookies set along the way are kept.

## CSRF token

POST requests need a `csrftoken` header. Shufersal sets the same value in an
`XSRF-TOKEN` cookie on the response that starts a server session, so HTTP mode
reads it from the jar and never loads a page for it.

- The token belongs to the server session (`JSESSIONID`), not to the saved
  cookies. A saved `JSESSIONID` has usually expired, so the first request of a
  new session gets a fresh one and a fresh `XSRF-TOKEN`, without logging in
  again (the long-lived `accjwt` cookie covers that).
- A wrong or stale token gets `405 Method Not Allowed` and changes nothing.
- A server session expires after 15 to 30 minutes without requests: a token
  still worked after 15 idle minutes and got `405` after 30.
- On a 405, the session sends one GET
  (`/timeSlot/preselection/getSelectedTimeslot`) to pick up the current token
  and retries the POST once.

## When the session falls back to the browser

The session switches to the browser, logs a warning starting with `[shufersal]`
and ending with `switching this session to the browser`, and stays on the
browser for the rest of its life when:

- a response is `403` or `429`,
- a small HTML response looks like a bot-protection page (F5 "Request Rejected",
  Incapsula, Cloudflare challenge),
- a GET fails before any response arrives (a POST that fails this way is
  rethrown, because it may have gone through),
- a POST still gets `405` after refreshing the token.

Switching copies the jar's cookies into a new browser page, loads
`/wish-lists/main`, and logs in if needed. From then on requests run inside the
page with `fetch`, exactly as before this change.

If the warning shows up, Shufersal has probably started blocking plain HTTP.
Check what the HTTP response was (the warning includes its status and the start
of its body) before changing anything.

## Choosing the transport

Pass `transport: 'http'` to `ShufersalBot` to send requests from Node:

```typescript
const bot = new ShufersalBot({ browserWSEndpoint, transport: 'http' });
```

With `transport: 'browser'` (the default for now) the session skips HTTP
entirely, as before this change: it opens its browser page when it is created,
loads `/wish-lists/main` on restore and sends every request from the page. Use
it to go back to the browser if Shufersal starts blocking HTTP.

## Opening the browser lazily

`browser` can be a function that returns a browser. The bot calls it only when a
session first needs a browser, so a caller that connects to a remote Chrome pays
for that connection only on login, checkout, or fallback.

```typescript
const bot = new ShufersalBot({
  browser: () => puppeteer.connect({ browserWSEndpoint }),
});
```

To point HTTP mode at a test server, pass your own `fetch` (for example one that
resolves `www.shufersal.co.il` to a local fake).

## How this was checked

On 2026-11-20, against a real account, from a home connection and from Cloud Run
in `me-west1` (Google's default outbound addresses):

- Reads returned the same data as the browser, with or without a Chrome
  `User-Agent`.
- Adding a product to the cart and removing it worked with the `XSRF-TOKEN`
  value as the token.
- A missing, wrong, or other-session token got `405` and left the cart
  unchanged.
- Shufersal's responses are all `Cache-Control: no-store` with no `ETag`, so
  there is nothing to cache.
- With a kept-alive connection, repeat calls took about 100–200ms, the same as
  the browser. The browser needed about 7 seconds to connect and load its first
  page before the first call.
