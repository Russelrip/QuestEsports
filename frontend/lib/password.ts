export const passwordFitsBcrypt = (value: string) =>
  new TextEncoder().encode(value).byteLength <= 72;

export const passwordByteLimitMessage = "Password must be no more than 72 UTF-8 bytes.";
