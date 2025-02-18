import assert from 'assert';

import puppeteer, { Browser, Page } from 'puppeteer-core';

import { AccountOrders, CartItem, OrderDetails } from './types';

interface ShufersalBotOptions {
  executablePath: string;
  headless?: boolean;
}

declare global {
  interface Window {
    ACC: {
      config: {
        CSRFToken: string;
      };
    };
  }
}

const BASE_URL = 'https://www.shufersal.co.il/online/he';

export class ShufersalSession {
  constructor(private page: Page) {}

  async getOrders() {
    return this.apiRequest<AccountOrders>('GET', '/my-account/orders');
  }

  async getOrderDetails(code: string) {
    return this.apiRequest<OrderDetails>('GET', `/my-account/orders/${code}`);
  }

  async addToCart(items: CartItem[]) {
    return this.apiRequest<void>('POST', '/cart/addGrid', items);
  }

  private async apiRequest<T extends object | void>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ) {
    const data = await this.page.evaluate(
      async (url, method, body) => {
        const csrftoken = window.ACC.config.CSRFToken;
        const response = await fetch(url, {
          headers: {
            'content-type': 'application/json',
            csrftoken,
          },
          method,
          body: body ? JSON.stringify(body) : undefined,
          mode: 'cors',
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        if (
          response.headers.get('content-type')?.includes('application/json')
        ) {
          const data = await response.json();
          return data;
        }
      },
      `${BASE_URL}${path}`,
      method,
      body,
    );
    return data as T;
  }
}

export class ShufersalBot {
  private browser: Browser | undefined;

  constructor(private options: ShufersalBotOptions) {}

  async createSession(username: string, password: string) {
    const page = await this.createPage();

    await page.goto(`${BASE_URL}/login`);
    await page.type('#j_username', username);
    await page.type('#j_password', password);
    await page.click('.btn-login');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });

    return new ShufersalSession(page);
  }

  async terminate() {
    assert(this.browser);
    await this.browser.close();
    this.browser = undefined;
  }

  private async initIfNeeded() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        executablePath: this.options.executablePath,
        headless: 'headless' in this.options ? this.options.headless : true,
      });
    }
  }

  private async createPage() {
    await this.initIfNeeded();
    assert(this.browser);

    const page = await this.browser.newPage();
    return page;
  }
}
