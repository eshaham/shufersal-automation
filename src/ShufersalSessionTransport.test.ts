import type { CookieData } from 'puppeteer-core';

import {
  BrowserPage,
  ShufersalBot,
  ShufersalSession,
  WEBAPP_URL,
} from './ShufersalBot';

jest.mock('puppeteer-core', () => ({ __esModule: true, default: {} }));

const STORED_COOKIES: CookieData[] = [
  { name: 'accjwt', value: 'jwt', domain: '.shufersal.co.il', path: '/' },
];

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
  return new Response(body, { status, headers: responseHeaders });
}

const json = (body: unknown, cookies: string[] = []) =>
  respond(200, JSON.stringify(body), {
    'content-type': 'application/json',
    'set-cookie': cookies,
  });

function createBrowser() {
  const page = {
    on: jest.fn(),
    goto: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue(`${WEBAPP_URL}/wish-lists/main`),
    evaluate: jest.fn(),
    mainFrame: jest.fn(),
  };
  const context = {
    setCookie: jest.fn().mockResolvedValue(undefined),
    cookies: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const openBrowser = jest
    .fn<Promise<BrowserPage>, []>()
    .mockResolvedValue({ page, context } as unknown as BrowserPage);
  return { page, context, openBrowser };
}

function createSession(responses: Response[], cookies = STORED_COOKIES) {
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  const browser = createBrowser();
  const session = new ShufersalSession(
    browser.openBrowser,
    { username: 'user', password: 'password' },
    { cookies, fetch: fetchMock as typeof fetch, transport: 'http' },
  );
  return { session, fetchMock, ...browser };
}

function requestPath(
  fetchMock: jest.Mock<Promise<Response>, Parameters<typeof fetch>>,
  call: number,
): string {
  return (fetchMock.mock.calls[call][0] as URL).pathname;
}

function sentHeader(
  fetchMock: jest.Mock<Promise<Response>, Parameters<typeof fetch>>,
  call: number,
  name: string,
): string | undefined {
  return (fetchMock.mock.calls[call][1]?.headers as Record<string, string>)[
    name
  ];
}

beforeEach(() => {
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ShufersalSession over HTTP', () => {
  it('reads without opening a browser', async () => {
    const { session, fetchMock, openBrowser } = createSession([
      json({ code: 'slot-1', fromHour: 1795000000000 }),
    ]);

    await session.getSelectedTimeSlot();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(openBrowser).not.toHaveBeenCalled();
    expect(session.activeTransport).toBe('http');
  });

  it('gets the CSRF token from the XSRF-TOKEN cookie before the first POST', async () => {
    const { session, fetchMock, openBrowser } = createSession([
      json(null, ['XSRF-TOKEN=a%2Bb; Path=/']),
      json({}),
    ]);

    await session.selectTimeSlot({
      code: 'slot',
      rawData: {},
    } as unknown as Parameters<ShufersalSession['selectTimeSlot']>[0]);

    expect(requestPath(fetchMock, 0)).toBe(
      '/online/he/timeSlot/preselection/getSelectedTimeslot',
    );
    expect(requestPath(fetchMock, 1)).toBe(
      '/online/he/timeSlot/preselection/postHomeDeliverySlot',
    );
    expect(sentHeader(fetchMock, 1, 'csrftoken')).toBe('a+b');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('refreshes the token and retries once when a POST gets 405', async () => {
    const { session, fetchMock, openBrowser } = createSession(
      [
        respond(405, 'Method Not Allowed', {
          'set-cookie': 'XSRF-TOKEN=fresh; Path=/',
        }),
        json(null),
        json({}),
      ],
      [
        ...STORED_COOKIES,
        { name: 'XSRF-TOKEN', value: 'stale', domain: 'www.shufersal.co.il' },
      ],
    );

    await session.clearCart();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sentHeader(fetchMock, 0, 'csrftoken')).toBe('stale');
    expect(sentHeader(fetchMock, 2, 'csrftoken')).toBe('fresh');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('logs in through the browser when redirected to login, then stays on HTTP', async () => {
    const { session, fetchMock } = createSession([
      respond(302, '', { location: `${WEBAPP_URL}/login` }),
      json({ code: 'slot-1', fromHour: 1795000000000 }),
    ]);
    const login = jest
      .spyOn(session, 'performLogin')
      .mockResolvedValue(undefined);

    await session.getSelectedTimeSlot();

    expect(login).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(session.activeTransport).toBe('http');
  });
});

describe('ShufersalSession browser fallback', () => {
  it('switches to the browser when HTTP is blocked', async () => {
    const { session, page, context, openBrowser } = createSession([
      respond(403, 'Forbidden'),
    ]);
    page.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ status: 200, data: { code: 'slot-1' } });

    await session.getSelectedTimeSlot();

    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(context.setCookie).toHaveBeenCalledWith(...STORED_COOKIES);
    expect(page.goto).toHaveBeenCalledWith(
      `${WEBAPP_URL}/wish-lists/main`,
      expect.anything(),
    );
    expect(session.activeTransport).toBe('browser');
  });

  it('switches to the browser when a POST still gets 405 after a token refresh', async () => {
    const { session, page, openBrowser } = createSession(
      [
        respond(405, 'Method Not Allowed'),
        json(null),
        respond(405, 'Method Not Allowed'),
      ],
      [
        ...STORED_COOKIES,
        { name: 'XSRF-TOKEN', value: 't', domain: 'www.shufersal.co.il' },
      ],
    );
    page.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ status: 200, data: {} });
    Object.assign(page, {
      waitForFunction: jest.fn().mockResolvedValue({
        jsonValue: jest.fn().mockResolvedValue('browser-token'),
        dispose: jest.fn().mockResolvedValue(undefined),
      }),
    });

    await session.clearCart();

    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(session.activeTransport).toBe('browser');
  });

  it('does not open a browser just to capture diagnostics', async () => {
    const { session, openBrowser } = createSession([]);

    await expect(session.takeScreenshot()).rejects.toThrow(
      'No browser page is open',
    );
    await session.close();

    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('serializes the cookies HTTP collected', async () => {
    const { session } = createSession([
      json({ code: 'slot-1', fromHour: 1795000000000 }, [
        'JSESSIONID=new; Path=/; HttpOnly',
      ]),
    ]);

    await session.getSelectedTimeSlot();
    const { cookies } = await session.serialize();

    expect(cookies).toEqual([
      ...STORED_COOKIES,
      {
        name: 'JSESSIONID',
        value: 'new',
        domain: 'www.shufersal.co.il',
        path: '/',
        httpOnly: true,
      },
    ]);
  });
});

describe('ShufersalBot transport choice', () => {
  function createBot(transport?: 'http' | 'browser') {
    const { page, context } = createBrowser();
    page.evaluate.mockResolvedValue(true);
    const browser = {
      createBrowserContext: jest.fn().mockResolvedValue({
        ...context,
        newPage: jest.fn().mockResolvedValue(page),
      }),
    };
    const bot = new ShufersalBot({
      browser: browser as unknown as ConstructorParameters<
        typeof ShufersalBot
      >[0]['browser'],
      transport,
    });
    return { bot, browser, page };
  }

  it('keeps the browser behavior by default', async () => {
    const { bot, browser, page } = createBot();

    const session = await bot.createSession('user', 'password', {
      cookies: STORED_COOKIES,
    });

    expect(browser.createBrowserContext).toHaveBeenCalledTimes(1);
    expect(session.activeTransport).toBe('browser');
    expect(session.browserPage).toBe(page);
    expect(page.goto).toHaveBeenCalledWith(
      `${WEBAPP_URL}/wish-lists/main`,
      expect.anything(),
    );
  });

  it('opens no browser to restore an HTTP session', async () => {
    const { bot, browser } = createBot('http');

    const session = await bot.createSession('user', 'password', {
      cookies: STORED_COOKIES,
    });

    expect(browser.createBrowserContext).not.toHaveBeenCalled();
    expect(session.activeTransport).toBe('http');
    expect(session.hasBrowser).toBe(false);
  });
});
