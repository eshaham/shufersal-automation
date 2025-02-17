import assert = require('assert');
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { AccountOrders } from './types';

interface ShufersalBotOptions {
  executablePath: string;
  headless?: boolean;
}

const BASE_URL = 'https://www.shufersal.co.il/online/he';

export class ShufersalBot {
  private browser: Browser | undefined;

  constructor(private options: ShufersalBotOptions) {}

  async createPage() {
    await this.initIfNeeded();
    assert(this.browser);

    const page = await this.browser.newPage();
    return page;
  }

  async login(page: Page, username: string, password: string) {
    await page.goto(`${BASE_URL}/login`);
    await page.type('#j_username', username);
    await page.type('#j_password', password);
    await page.click('.btn-login');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
  }

  async getOrders(page: Page) {
    return this.apiRequest<AccountOrders>(page, 'GET', '/my-account/orders');
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
        headless: !!this.options.headless,
      });
    }
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
      method
    );
    return data as T;
  }
}
