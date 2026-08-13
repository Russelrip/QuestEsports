export const EVENT_ALBUM_UPLOAD_BATCH_SIZE = 10;

export const buildEventAlbumUploadBatches = <T>(items: readonly T[]) => {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += EVENT_ALBUM_UPLOAD_BATCH_SIZE) {
    batches.push(items.slice(index, index + EVENT_ALBUM_UPLOAD_BATCH_SIZE));
  }
  return batches;
};
