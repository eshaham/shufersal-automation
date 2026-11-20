import { CookieJar } from './CookieJar';
import {
  HttpBlockedError,
  HttpStatusError,
  HttpTransport,
  LoginRedirectError,
} from './HttpTransport';

const BASE = 'https://www.shufersal.co.il/online/he';

function respond(
  status: number,
  body: string,
  headers: Record<string, string | string[]> = {},
): Response {
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      responseHeaders.append(name, item);
    }
  }
  return new Response(status === 204 ? null : body, {
    status,
    headers: responseHeaders,
  });
}

function createTransport(responses: Response[]) {
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  const jar = new CookieJar([
    { name: 'accjwt', value: 'jwt', domain: '.shufersal.co.il', path: '/' },
  ]);
  const transport = new HttpTransport(jar, fetchMock as typeof fetch, {
    csrfHeaderName: 'csrftoken',
    isLoginRedirect: (location) => location.includes('/login'),
  });
  return { transport, fetchMock, jar };
}

function sentHeaders(
  fetchMock: jest.Mock<Promise<Response>, Parameters<typeof fetch>>,
  call = 0,
): Record<string, string> {
  return fetchMock.mock.calls[call][1]?.headers as Record<string, string>;
}

describe('HttpTransport', () => {
  it('parses JSON with the stored cookies and a browser user agent', async () => {
    const { transport, fetchMock } = createTransport([
      respond(200, '{"code":"slot"}', { 'content-type': 'application/json' }),
    ]);

    const result = await transport.send(
      {
        method: 'GET',
        url: `${BASE}/timeSlot/preselection/getSelectedTimeslot`,
      },
      'json',
    );

    expect(result).toEqual({ status: 200, data: { code: 'slot' } });
    const headers = sentHeaders(fetchMock);
    expect(headers['cookie']).toBe('accjwt=jwt');
    expect(headers['user-agent']).toContain('Chrome/');
  });

  it('sends the CSRF token and JSON body on POST', async () => {
    const { transport, fetchMock } = createTransport([
      respond(200, '<html><body></body></html>', {
        'content-type': 'text/html',
      }),
    ]);

    await transport.send(
      {
        method: 'POST',
        url: `${BASE}/cart/addGrid`,
        body: [{ productCode: 'P_1' }],
        csrfToken: 'token',
      },
      'html',
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.body).toBe('[{"productCode":"P_1"}]');
    expect(sentHeaders(fetchMock)['csrftoken']).toBe('token');
  });

  it('returns the HTML of html responses', async () => {
    const html =
      '<html><body><article data-product-code="P_1"></article></body></html>';
    const { transport } = createTransport([
      respond(200, html, { 'content-type': 'text/html;charset=UTF-8' }),
    ]);

    const result = await transport.send(
      { method: 'GET', url: `${BASE}/cart/load?restoreCart=true` },
      'html',
    );

    expect(result).toEqual({ status: 200, data: html });
  });

  it('returns no data for html requests answered with JSON', async () => {
    const { transport } = createTransport([
      respond(200, '{}', { 'content-type': 'application/json' }),
    ]);

    const result = await transport.send(
      { method: 'GET', url: `${BASE}/cart/load` },
      'html',
    );

    expect(result).toEqual({ status: 200, data: undefined });
  });

  it('sends per-request headers and the CSRF token under the configured name', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        respond(200, '{}', { 'content-type': 'application/json' }),
      );
    const transport = new HttpTransport(
      new CookieJar(),
      fetchMock as typeof fetch,
      { csrfHeaderName: 'x-csrf-token' },
    );

    await transport.send(
      {
        method: 'DELETE',
        url: 'https://api.example.com/cart',
        csrfToken: 'token',
        headers: { EcomToken: 'jwt', Locale: 'he' },
      },
      'json',
    );

    const headers = sentHeaders(fetchMock);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
    expect(headers['x-csrf-token']).toBe('token');
    expect(headers['csrftoken']).toBeUndefined();
    expect(headers['EcomToken']).toBe('jwt');
    expect(headers['Locale']).toBe('he');
  });

  it('does not treat redirects as logins without a login matcher', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(respond(302, '', { location: `${BASE}/login` }));
    const transport = new HttpTransport(
      new CookieJar(),
      fetchMock as typeof fetch,
    );

    const error = await transport
      .send({ method: 'GET', url: `${BASE}/my-account` }, 'json')
      .catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(LoginRedirectError);
    expect((error as HttpStatusError).status).toBe(302);
  });

  it('stores cookies from every response', async () => {
    const { transport, jar } = createTransport([
      respond(200, '{}', {
        'content-type': 'application/json',
        'set-cookie': [
          'JSESSIONID=fresh; Path=/; HttpOnly',
          'XSRF-TOKEN=t1; Path=/',
        ],
      }),
    ]);

    await transport.send({ method: 'GET', url: `${BASE}/cart/load` }, 'json');

    expect(jar.headerFor(new URL(BASE))).toBe(
      'accjwt=jwt; JSESSIONID=fresh; XSRF-TOKEN=t1',
    );
  });

  it('throws LoginRedirectError when redirected to login', async () => {
    const { transport } = createTransport([
      respond(302, '', { location: `${BASE}/login` }),
    ]);

    await expect(
      transport.send(
        { method: 'GET', url: `${BASE}/my-account/orders` },
        'json',
      ),
    ).rejects.toBeInstanceOf(LoginRedirectError);
  });

  it('follows redirects for pages and returns the final URL', async () => {
    const { transport, fetchMock } = createTransport([
      respond(302, '', {
        location: '/online/he/checkout/orderConfirmation/1234567',
        'set-cookie': 'step=1; Path=/',
      }),
      respond(200, '<html>done</html>', { 'content-type': 'text/html' }),
    ]);

    const result = await transport.send(
      { method: 'GET', url: `${BASE}/checkout/redirect` },
      'page',
    );

    expect(result.data).toEqual({
      url: `${BASE}/checkout/orderConfirmation/1234567`,
      html: '<html>done</html>',
    });
    expect(sentHeaders(fetchMock, 1)['cookie']).toBe('accjwt=jwt; step=1');
  });

  it.each([403, 429])('treats %i as blocked', async (status) => {
    const { transport } = createTransport([respond(status, 'nope')]);

    await expect(
      transport.send({ method: 'GET', url: `${BASE}/cart/load` }, 'json'),
    ).rejects.toBeInstanceOf(HttpBlockedError);
  });

  it('treats a small bot-protection page as blocked', async () => {
    const { transport } = createTransport([
      respond(
        200,
        '<html><head><title>Request Rejected</title></head><body>The requested URL was rejected.</body></html>',
        { 'content-type': 'text/html' },
      ),
    ]);

    await expect(
      transport.send({ method: 'GET', url: `${BASE}/cart/load` }, 'html'),
    ).rejects.toBeInstanceOf(HttpBlockedError);
  });

  it('treats a network failure on GET as blocked but rethrows it on POST', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockRejectedValue(new TypeError('fetch failed'));
    const transport = new HttpTransport(
      new CookieJar(),
      fetchMock as typeof fetch,
    );

    await expect(
      transport.send({ method: 'GET', url: `${BASE}/cart/load` }, 'json'),
    ).rejects.toBeInstanceOf(HttpBlockedError);
    await expect(
      transport.send({ method: 'POST', url: `${BASE}/cart/addGrid` }, 'html'),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('reports other failures with their status', async () => {
    const { transport } = createTransport([
      respond(405, 'Method Not Allowed', { 'content-type': 'text/html' }),
    ]);

    const error = await transport
      .send({ method: 'POST', url: `${BASE}/cart/addGrid` }, 'html')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(405);
  });

  it('returns undefined text for failed text requests', async () => {
    const { transport } = createTransport([respond(404, 'missing')]);

    const result = await transport.send(
      { method: 'GET', url: `${BASE}/promotionPopup/1` },
      'text',
    );

    expect(result).toEqual({ status: 404, data: undefined });
  });
});
