import type {
  Browser,
  BrowserContext,
  ElementHandle,
  HTTPResponse,
  Page,
} from 'puppeteer-core';

import type {
  CodeLogin,
  CodeLoginResult,
  CodeRequest,
  PendingCodeLogin,
} from '../core/GrocerySession';
import type { SerializedSessionData } from '../core/types';
import { RAMI_LEVY_SITE_URL } from './RamiLevySession';

const LOGIN_PATH = '/api/v2/site/auth/login';
const RECAPTCHA_CHALLENGE_FRAME = 'iframe[src*="recaptcha/api2/bframe"]';
const OPEN_LOGIN_XPATH = './/*[normalize-space(text())="התחברות"]';
const SEND_CODE_XPATH = './/button[normalize-space(.)="שלח קוד אימות"]';
const VERIFY_XPATH = './/button[starts-with(normalize-space(.), "אמת")]';
const EMAIL_INPUT = 'input[type=email]';
const CODE_INPUT = 'input[placeholder*="קוד"]';
const POLL_INTERVAL_MS = 250;
const TYPING_DELAY_MS = 120;
const SETTLE_DELAY_MS = 1_000;
const TYPING_ATTEMPTS = 3;
const RATE_LIMITED_STATUS = 3;
const USER_NOT_FOUND_STATUS = -3;
const DEFAULT_TIMEOUT_MS = 30_000;
const JWT_PATTERN = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/;

export type RamiLevyLoginFailure =
  | 'challenge'
  | 'rate-limited'
  | 'user-not-found'
  | 'unsupported-step'
  | 'invalid-code'
  | 'unexpected-response';

export class RamiLevyLoginError extends Error {
  constructor(
    readonly reason: RamiLevyLoginFailure,
    message: string,
  ) {
    super(message);
    this.name = 'RamiLevyLoginError';
  }
}

export interface RamiLevyLoginResponse {
  status?: number;
  message?: string;
  otp_required?: boolean;
  phone_last_digits?: string;
  email_hint?: string;
  email_otp_required?: boolean;
  phone_required?: boolean;
  phone_email_required?: boolean;
  restore_account_flow?: boolean;
  user?: { id?: number } & Record<string, unknown>;
  [key: string]: unknown;
}

export type RamiLevyLoginStep =
  | ({ kind: 'code-sent' } & CodeRequest)
  | { kind: 'logged-in'; token: string; customerId: number };

function findJwt(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return JWT_PATTERN.test(value) ? value : undefined;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      const token = findJwt(nested);
      if (token) {
        return token;
      }
    }
  }
  return undefined;
}

function jwtExpiry(token: string): string | undefined {
  const { exp } = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as { exp?: number };
  return exp ? new Date(exp * 1000).toISOString() : undefined;
}

export function interpretLoginResponse(
  response: RamiLevyLoginResponse,
): RamiLevyLoginStep {
  const message = response.message ?? 'no message';
  if (response.status === RATE_LIMITED_STATUS) {
    throw new RamiLevyLoginError(
      'rate-limited',
      `Rami Levy is limiting login attempts: ${message}`,
    );
  }
  if (response.status === USER_NOT_FOUND_STATUS) {
    throw new RamiLevyLoginError(
      'user-not-found',
      `Rami Levy has no customer with this email: ${message}`,
    );
  }
  if (response.email_otp_required) {
    return {
      kind: 'code-sent',
      channel: 'email',
      destination: response.email_hint ?? null,
    };
  }
  if (
    response.phone_required ||
    response.phone_email_required ||
    response.restore_account_flow
  ) {
    throw new RamiLevyLoginError(
      'unsupported-step',
      `Rami Levy asked for a login step this library doesn't handle: ${message}`,
    );
  }
  if (response.otp_required) {
    return {
      kind: 'code-sent',
      channel: 'sms',
      destination: response.phone_last_digits ?? null,
    };
  }
  const token = findJwt(response);
  const customerId = response.user?.id;
  if (token && customerId) {
    return { kind: 'logged-in', token, customerId };
  }
  throw new RamiLevyLoginError(
    'unexpected-response',
    `Rami Levy's login response had no code step and no token: ${message}`,
  );
}

export function interpretCodeResponse(
  response: RamiLevyLoginResponse,
  submitted: CodeRequest,
): RamiLevyLoginStep {
  const rejected = new RamiLevyLoginError(
    'invalid-code',
    `Rami Levy didn't accept the code: ${response.message ?? 'no message'}`,
  );
  let step: RamiLevyLoginStep;
  try {
    step = interpretLoginResponse(response);
  } catch (error) {
    if (
      error instanceof RamiLevyLoginError &&
      error.reason === 'unexpected-response'
    ) {
      throw rejected;
    }
    throw error;
  }
  if (step.kind === 'code-sent' && step.channel === submitted.channel) {
    throw rejected;
  }
  return step;
}

export function loginSessionData(
  token: string,
  customerId: number,
): SerializedSessionData {
  return {
    cookies: [],
    credentials: { token, expiresAt: jwtExpiry(token) },
    context: { customerId: String(customerId) },
  };
}

export interface RamiLevyLoginOptions {
  browser: Browser | (() => Promise<Browser>);
  keepBrowserData?: boolean;
  timeoutMs?: number;
}

async function firstVisible(
  page: Page,
  selector: string,
  timeoutMs: number,
): Promise<ElementHandle> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const element of await page.$$(selector)) {
      if (await element.isVisible()) {
        return element;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new RamiLevyLoginError(
    'unexpected-response',
    `The Rami Levy login form never showed ${selector}`,
  );
}

async function fieldValue(field: ElementHandle): Promise<string> {
  const property = await field.getProperty('value');
  return String(await property.jsonValue());
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureFocused(field: ElementHandle): Promise<void> {
  const focused = await field.evaluate(
    (element) => element === document.activeElement,
  );
  if (!focused) {
    await field.click();
    await field.press('End');
  }
}

async function fillField(field: ElementHandle, value: string): Promise<void> {
  await field.click({ count: 3 });
  await field.press('Backspace');
  let current = await fieldValue(field);
  let keystrokes = 0;
  while (current !== value && keystrokes < value.length * TYPING_ATTEMPTS) {
    await ensureFocused(field);
    if (value.startsWith(current)) {
      await field.type(value[current.length], { delay: TYPING_DELAY_MS });
    } else {
      await field.press('Backspace');
    }
    keystrokes++;
    await pause(TYPING_DELAY_MS);
    current = await fieldValue(field);
  }
  if (current !== value) {
    throw new RamiLevyLoginError(
      'unexpected-response',
      `The Rami Levy login form holds ${String(current.length)} of the ${String(value.length)} typed characters`,
    );
  }
  await pause(SETTLE_DELAY_MS);
}

class RamiLevyPendingLogin implements PendingCodeLogin {
  private closed = false;

  constructor(
    private readonly release: () => Promise<void>,
    private readonly page: Page,
    private readonly timeoutMs: number,
    public codeRequest: CodeRequest,
  ) {}

  async submitCode(code: string): Promise<CodeLoginResult> {
    if (this.closed) {
      throw new RamiLevyLoginError(
        'unexpected-response',
        'This Rami Levy login was already completed or cancelled',
      );
    }
    const input = await firstVisible(this.page, CODE_INPUT, this.timeoutMs);
    await fillField(input, code);
    const button = await firstVisible(
      this.page,
      `xpath/${VERIFY_XPATH}`,
      this.timeoutMs,
    );
    const response = await submitAndReadLogin(
      this.page,
      button,
      this.timeoutMs,
    );
    const step = interpretCodeResponse(response, this.codeRequest);
    if (step.kind === 'code-sent') {
      this.codeRequest = {
        channel: step.channel,
        destination: step.destination,
      };
      return { status: 'code-sent', ...this.codeRequest };
    }
    await this.cancel();
    return {
      status: 'logged-in',
      sessionData: loginSessionData(step.token, step.customerId),
    };
  }

  async cancel(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.release();
  }
}

async function submitAndReadLogin(
  page: Page,
  button: ElementHandle,
  timeoutMs: number,
): Promise<RamiLevyLoginResponse> {
  const loginResponse = page.waitForResponse(
    (response: HTTPResponse) =>
      response.url().includes(LOGIN_PATH) &&
      response.request().method() === 'POST',
    { timeout: timeoutMs },
  );
  const challenge = page
    .waitForSelector(RECAPTCHA_CHALLENGE_FRAME, {
      visible: true,
      timeout: timeoutMs,
    })
    .then(() => 'challenge' as const)
    .catch(() => 'no-challenge' as const);
  await button.click();
  const first = await Promise.race([loginResponse, challenge]);
  if (first === 'challenge') {
    throw new RamiLevyLoginError(
      'challenge',
      'Rami Levy showed a reCAPTCHA challenge, so the customer has to log in on the site',
    );
  }
  if (first === 'no-challenge') {
    return (await (await loginResponse).json()) as RamiLevyLoginResponse;
  }
  return (await first.json()) as RamiLevyLoginResponse;
}

export class RamiLevyLogin implements CodeLogin {
  private readonly timeoutMs: number;

  constructor(private readonly options: RamiLevyLoginOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async start(email: string): Promise<PendingCodeLogin> {
    const browser =
      typeof this.options.browser === 'function'
        ? await this.options.browser()
        : this.options.browser;
    const context: BrowserContext = this.options.keepBrowserData
      ? browser.defaultBrowserContext()
      : await browser.createBrowserContext();
    const page = await context.newPage();
    const release = this.options.keepBrowserData
      ? () => page.close()
      : () => context.close();
    try {
      await page.goto(`${RAMI_LEVY_SITE_URL}/he`, {
        waitUntil: 'networkidle2',
        timeout: this.timeoutMs,
      });
      const openLogin = await firstVisible(
        page,
        `xpath/${OPEN_LOGIN_XPATH}`,
        this.timeoutMs,
      );
      await openLogin.click();
      await pause(SETTLE_DELAY_MS);
      const emailInput = await firstVisible(page, EMAIL_INPUT, this.timeoutMs);
      await fillField(emailInput, email);
      const response = await submitAndReadLogin(
        page,
        await firstVisible(page, `xpath/${SEND_CODE_XPATH}`, this.timeoutMs),
        this.timeoutMs,
      );
      const step = interpretLoginResponse(response);
      if (step.kind === 'logged-in') {
        throw new RamiLevyLoginError(
          'unexpected-response',
          'Rami Levy logged in without sending a code',
        );
      }
      return new RamiLevyPendingLogin(release, page, this.timeoutMs, {
        channel: step.channel,
        destination: step.destination,
      });
    } catch (error) {
      await release();
      throw error;
    }
  }
}
