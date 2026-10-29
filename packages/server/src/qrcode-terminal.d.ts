// packages/server/src/qrcode-terminal.d.ts
declare module "qrcode-terminal" {
  export interface GenerateOptions {
    readonly small?: boolean;
  }
  export function generate(
    text: string,
    options?: GenerateOptions,
    callback?: (qr: string) => void,
  ): void;
  const qrcode: {
    generate(
      text: string,
      options?: GenerateOptions,
      callback?: (qr: string) => void,
    ): void;
  };
  export default qrcode;
}
