export class ShufersalSessionError extends Error {
  screenshot?: Buffer;

  constructor(message: string, originalError: Error, screenshot?: Buffer) {
    super(message);
    this.name = originalError.name;
    this.stack = originalError.stack;
    this.screenshot = screenshot;
  }
}
