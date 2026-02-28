export class ShufersalSessionError extends Error {
  screenshot?: Buffer;
  pageContent?: string;

  constructor(
    message: string,
    originalError: Error,
    screenshot?: Buffer,
    pageContent?: string,
  ) {
    super(message);
    this.name = originalError.name;
    this.stack = originalError.stack;
    this.screenshot = screenshot;
    this.pageContent = pageContent;
  }
}
