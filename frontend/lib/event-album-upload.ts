export const EVENT_ALBUM_UPLOAD_BATCH_SIZE = 1;

type NamedUploadItem = {
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

export const buildEventAlbumUploadBatches = <T>(items: readonly T[]) =>
  items.map((item) => [item]);
