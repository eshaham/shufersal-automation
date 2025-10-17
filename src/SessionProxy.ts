import { ShufersalSession } from './ShufersalBot';
import { ShufersalSessionError } from './ShufersalSessionError';

export function createSessionProxy(
  session: ShufersalSession,
): ShufersalSession {
  return new Proxy(session, {
    get(target, prop, receiver) {
      const original = Reflect.get(
        target,
        prop,
        receiver,
      ) as unknown as ShufersalSession[keyof ShufersalSession];

      if (typeof original === 'function' && prop !== 'takeScreenshot') {
        return async function (
          this: ShufersalSession,
          ...args: unknown[]
        ): Promise<unknown> {
          try {
            return await (
              original as (...args: unknown[]) => Promise<unknown>
            ).apply(target, args);
          } catch (error) {
            if (error instanceof Error) {
              let screenshot: Buffer | null = null;
              try {
                screenshot = await target.takeScreenshot();
              } catch (screenshotError) {
                console.warn(
                  'Failed to capture error screenshot:',
                  screenshotError,
                );
              }

              throw new ShufersalSessionError(
                error.message,
                error,
                screenshot || undefined,
              );
            }
            throw error;
          }
        };
      }

      return original as unknown;
    },
  });
}
