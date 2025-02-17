import assert = require('assert');
import puppeteer, { Browser } from 'puppeteer-core';

interface ShufersalBotOptions {
  executablePath: string;
}

export class ShufersalBot {
  private browser: Browser | undefined;

  constructor(private options: ShufersalBotOptions) {}

  async createSession(username: string, password: string) {
    await this.initIfNeeded();
    assert(this.browser);

    const page = await this.browser.newPage();
    await page.goto('https://www.shufersal.co.il/online/he/login');
    await page.type('#j_username', username);
    await page.type('#j_password', password);
    await page.click('.btn-login');
  }

  private async initIfNeeded() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        executablePath: this.options.executablePath,
      });
    }
  }
}
