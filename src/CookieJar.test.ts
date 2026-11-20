import { CookieJar, parseSetCookie } from './CookieJar';

const page = new URL('https://www.shufersal.co.il/online/he/cart/load');

describe('CookieJar', () => {
  it('sends stored browser cookies that match the host and path', () => {
    const jar = new CookieJar([
      { name: 'accjwt', value: 'jwt', domain: '.shufersal.co.il', path: '/' },
      { name: 'JSESSIONID', value: 's1', domain: 'www.shufersal.co.il' },
      { name: 'other', value: 'x', domain: 'example.com', path: '/' },
      {
        name: 'scoped',
        value: 'y',
        domain: 'www.shufersal.co.il',
        path: '/online/en',
      },
    ]);

    expect(jar.headerFor(page)).toBe('accjwt=jwt; JSESSIONID=s1');
  });

  it('skips expired cookies', () => {
    const jar = new CookieJar([
      {
        name: 'old',
        value: '1',
        domain: '.shufersal.co.il',
        path: '/',
        expires: 1000,
      },
      {
        name: 'session',
        value: '2',
        domain: '.shufersal.co.il',
        path: '/',
        expires: -1,
      },
    ]);

    expect(jar.headerFor(page)).toBe('session=2');
  });

  it('replaces cookies from Set-Cookie and keeps the rest', () => {
    const jar = new CookieJar([
      { name: 'JSESSIONID', value: 'old', domain: 'www.shufersal.co.il' },
      { name: 'accjwt', value: 'jwt', domain: '.shufersal.co.il', path: '/' },
    ]);

    jar.absorb(
      [
        'JSESSIONID=new; Path=/; Secure; HttpOnly',
        'XSRF-TOKEN=abc%3D; Path=/; Secure',
      ],
      page,
    );

    expect(jar.headerFor(page)).toBe(
      'JSESSIONID=new; accjwt=jwt; XSRF-TOKEN=abc%3D',
    );
    expect(jar.get('XSRF-TOKEN', page)).toBe('abc%3D');
  });

  it('removes cookies that Set-Cookie expires', () => {
    const jar = new CookieJar([
      { name: 'gone', value: '1', domain: 'www.shufersal.co.il', path: '/' },
    ]);

    jar.absorb(['gone=; Path=/; Max-Age=0'], page);

    expect(jar.headerFor(page)).toBe('');
  });

  it('round-trips cookies in the shape puppeteer accepts', () => {
    const jar = new CookieJar();
    jar.absorb(
      ['a=1; Domain=shufersal.co.il; Path=/; Secure; HttpOnly; SameSite=None'],
      page,
    );

    expect(jar.toCookieData()).toEqual([
      {
        name: 'a',
        value: '1',
        domain: '.shufersal.co.il',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'None',
      },
    ]);
  });
});

describe('parseSetCookie', () => {
  it('reads Max-Age into an absolute expiry', () => {
    const parsed = parseSetCookie('a=1; Max-Age=60', page, 1_000_000);

    expect(parsed?.cookie.expires).toBe(1060);
    expect(parsed?.deleted).toBe(false);
  });

  it('ignores headers without a name', () => {
    expect(parseSetCookie('=1', page)).toBeNull();
  });
});
