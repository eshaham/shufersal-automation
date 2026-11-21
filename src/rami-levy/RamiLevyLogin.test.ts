import type { CodeRequest } from '../core/GrocerySession';
import {
  interpretCodeResponse,
  interpretLoginResponse,
  loginSessionData,
  RamiLevyLoginError,
} from './RamiLevyLogin';

function fakeJwt(exp: number): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ exp, cid: 1 })}.signature`;
}

function reasonOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof RamiLevyLoginError ? error.reason : 'other';
  }
  return undefined;
}

const SMS: CodeRequest = { channel: 'sms', destination: '1234' };
const EMAIL: CodeRequest = {
  channel: 'email',
  destination: 'c***@example.com',
};

describe('interpretLoginResponse', () => {
  it('reports an SMS code and the phone it went to', () => {
    expect(
      interpretLoginResponse({
        status: 1,
        otp_required: true,
        delivery_method: 'sms',
        phone_last_digits: '1234',
      }),
    ).toEqual({ kind: 'code-sent', ...SMS });
  });

  it('reports an email code and the address hint', () => {
    expect(
      interpretLoginResponse({
        status: 1,
        email_otp_required: true,
        email_hint: 'c***@example.com',
      }),
    ).toEqual({ kind: 'code-sent', ...EMAIL });
  });

  it('returns the token and customer id once logged in', () => {
    const token = fakeJwt(1_800_000_000);
    expect(
      interpretLoginResponse({
        status: 1,
        user: { id: 42, token },
      }),
    ).toEqual({ kind: 'logged-in', token, customerId: 42 });
  });

  it('rejects rate limiting, unknown users and unsupported steps', () => {
    expect(reasonOf(() => interpretLoginResponse({ status: 3 }))).toBe(
      'rate-limited',
    );
    expect(reasonOf(() => interpretLoginResponse({ status: -3 }))).toBe(
      'user-not-found',
    );
    expect(
      reasonOf(() =>
        interpretLoginResponse({ status: 1, phone_required: true }),
      ),
    ).toBe('unsupported-step');
    expect(reasonOf(() => interpretLoginResponse({ status: 0 }))).toBe(
      'unexpected-response',
    );
  });
});

describe('interpretCodeResponse', () => {
  it('treats a response without a token as a rejected code', () => {
    expect(
      reasonOf(() =>
        interpretCodeResponse({ status: 0, message: 'wrong code' }, SMS),
      ),
    ).toBe('invalid-code');
    expect(
      reasonOf(() =>
        interpretCodeResponse({ status: 1, otp_required: true }, SMS),
      ),
    ).toBe('invalid-code');
  });

  it('moves on when the next step asks for a code on another channel', () => {
    expect(
      interpretCodeResponse(
        { status: 1, otp_required: true, phone_last_digits: '1234' },
        EMAIL,
      ),
    ).toEqual({ kind: 'code-sent', ...SMS });
  });

  it('keeps rate limiting distinct from a wrong code', () => {
    expect(reasonOf(() => interpretCodeResponse({ status: 3 }, SMS))).toBe(
      'rate-limited',
    );
  });
});

describe('loginSessionData', () => {
  it('stores the token with its expiry and the customer id', () => {
    const token = fakeJwt(1_800_000_000);
    expect(loginSessionData(token, 42)).toEqual({
      cookies: [],
      credentials: {
        token,
        expiresAt: new Date(1_800_000_000 * 1000).toISOString(),
      },
      context: { customerId: '42' },
    });
  });
});
