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

// Long enough for any browser to have started reading the blob. Revoking in the
// same task as the click can cancel the download, which is what some browsers do.
const OBJECT_URL_LIFETIME_MS = 60_000;

// Saves a fetched file through a temporary link. The link is attached because
// some browsers ignore a click on a detached one.
export const saveBlob = (blob: Blob, filename: string) => {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_LIFETIME_MS);
};
