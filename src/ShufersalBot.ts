import assert from 'assert';

import puppeteer, { Browser, Page } from 'puppeteer-core';

import { AccountOrders, OrderDetails } from './types';

interface ShufersalBotOptions {
  executablePath: string;
  headless?: boolean;
}

const BASE_URL = 'https://www.shufersal.co.il/online/he';

export class ShufersalSession {
  constructor(private page: Page) {}

  async getOrders() {
    return this.apiRequest<AccountOrders>(
      this.page,
      'GET',
      '/my-account/orders',
    );
  }

  async getOrderDetails(code: string) {
    return this.apiRequest<OrderDetails>(
      this.page,
      'GET',
      `/my-account/orders/${code}`,
    );
  }

  private async apiRequest<T>(page: Page, method: 'GET', path: string) {
    const data = await page.evaluate(
      async (url, method) => {
        const response = await fetch(url, {
          headers: {
            'content-type': 'application/json',
          },
          method,
          mode: 'cors',
          credentials: 'include',
        });
        const data = await response.json();
        return data;
      },
      `${BASE_URL}${path}`,
      method,
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
