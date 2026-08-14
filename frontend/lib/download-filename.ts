const extensionByContentType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const normalizeContentType = (value?: string | null) => (value || "")
  .split(";", 1)[0]
  .trim()
  .toLowerCase();

const replaceExtension = (filename: string, extension: string) => {
  const basename = filename.split(/[\\/]/).pop()?.trim() || "event-photo";
  const withoutExtension = basename.replace(/\.[^.]*$/, "") || "event-photo";
  return `${withoutExtension}${extension}`;
};

export const getDownloadFilename = ({
  contentDisposition,
  contentType,
  originalName,
  fallbackName,
}: {
  contentDisposition?: string | null;
  contentType?: string | null;
  originalName?: string | null;
  fallbackName: string;
}) => {
  const headerFilename = contentDisposition?.match(/filename="([^"]+)"/i)?.[1];
  const extension = extensionByContentType[normalizeContentType(contentType)] || ".jpg";
  return replaceExtension(headerFilename || originalName || fallbackName, extension);
};
