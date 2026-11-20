type SessionMethod = (...args: unknown[]) => Promise<unknown>;

const diagnosticMethods = new Set(['takeScreenshot', 'takePageContent']);

export interface DiagnosableSession {
  takeScreenshot(): Promise<Buffer>;
  takePageContent(): Promise<string>;
}

export type SessionErrorFactory = (
  error: Error,
  screenshot?: Buffer,
  pageContent?: string,
) => Error;

export function createSessionProxy<T extends DiagnosableSession>(
  session: T,
  createError: SessionErrorFactory,
): T {
  return new Proxy(session, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;

      if (
        typeof value !== 'function' ||
        diagnosticMethods.has(prop as string)
      ) {
        return value;
      }

      const method = value as SessionMethod;

      return async (...args: unknown[]) => {
        try {
          return await method.apply(target, args);
        } catch (error) {
          if (!(error instanceof Error)) {
            throw error;
          }

          const [screenshot, pageContent] = await Promise.allSettled([
            target.takeScreenshot(),
            target.takePageContent(),
          ]);

          throw createError(
            error,
            screenshot.status === 'fulfilled' ? screenshot.value : undefined,
            pageContent.status === 'fulfilled' ? pageContent.value : undefined,
          );
        }
      };
    },
  });
}
