export const EVENT_ALBUM_UPLOAD_BATCH_SIZE = 10;
export const EVENT_ALBUM_UPLOAD_BATCH_MAX_BYTES = 18 * 1024 * 1024;

type UploadItem = {
  size?: number;
};

type NamedUploadItem = UploadItem & {
  name: string;
};

const normalizeUploadName = (value: string) => value.trim().toLocaleLowerCase();

export const excludeAlreadyUploadedFiles = <T extends NamedUploadItem>(
  items: readonly T[],
  existingNames: readonly (string | null | undefined)[],
) => {
  const uploadedNames = new Set(
    existingNames
      .filter((name): name is string => Boolean(name?.trim()))
      .map(normalizeUploadName),
  );
  const pending: T[] = [];
  const skipped: T[] = [];

  for (const item of items) {
    (uploadedNames.has(normalizeUploadName(item.name)) ? skipped : pending).push(item);
  }

  return { pending, skipped };
};

export const buildEventAlbumUploadBatches = <T extends UploadItem>(items: readonly T[]) => {
  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const itemBytes = Math.max(0, item.size || 0);
    const exceedsCount = currentBatch.length >= EVENT_ALBUM_UPLOAD_BATCH_SIZE;
    const exceedsBytes =
      currentBatch.length > 0 &&
      currentBytes + itemBytes > EVENT_ALBUM_UPLOAD_BATCH_MAX_BYTES;

    if (exceedsCount || exceedsBytes) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }

    currentBatch.push(item);
    currentBytes += itemBytes;
  }

  if (currentBatch.length) batches.push(currentBatch);
  return batches;
};
