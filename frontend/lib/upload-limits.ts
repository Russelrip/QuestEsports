const MEBIBYTE = 1024 * 1024;

export const TEAM_LOGO_MAX_FILE_SIZE = 5 * MEBIBYTE;
export const ADMIN_UPLOAD_MAX_FILE_SIZE = 10 * MEBIBYTE;

export const assertFileWithinUploadLimit = (
  file: File | null,
  maxFileSize: number,
  label: string
) => {
  if (file && file.size > maxFileSize) {
    throw new Error(`${label} cannot exceed ${maxFileSize / MEBIBYTE} MB.`);
  }
};
