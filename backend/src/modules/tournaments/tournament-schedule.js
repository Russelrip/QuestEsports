const { parse: parseCsv } = require("csv-parse/sync");
const { readSheet: readXlsxFile } = require("read-excel-file/node");
const { HttpError } = require("../../lib/http-error");
const { normalizeText } = require("../../lib/validation");

const normalizeScheduleCellValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }

    if ("result" in value && value.result !== undefined) {
      return String(value.result);
    }
  }

  return String(value);
};

const buildScheduleDataFromMatrix = ({ sheetName, matrix }) => {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return null;
  }

  const nonEmptyRows = matrix.filter((row) =>
    Array.isArray(row) && row.some((cell) => String(cell || "").trim().length > 0)
  );

  if (nonEmptyRows.length === 0) {
    return null;
  }

  const headerRow = nonEmptyRows[0];
  const headers = headerRow.map((header, index) =>
    String(header || `Column ${index + 1}`)
  );
  const rows = nonEmptyRows.slice(1).map((row) => {
    const record = {};

    headers.forEach((header, index) => {
      record[header] = String(row[index] || "");
    });

    return record;
  });

  return {
    sheetName,
    headers,
    rows,
  };
};

const buildScheduleData = async (file) => {
  if (!file?.buffer) {
    return null;
  }

  const extension = String(file.originalname || "")
    .split(".")
    .pop()
    ?.toLowerCase();

  if (extension === "csv") {
    const records = parseCsv(file.buffer, {
      bom: true,
      skip_empty_lines: true,
    });

    return buildScheduleDataFromMatrix({
      sheetName: "Schedule",
      matrix: records,
    });
  }

  if (extension === "xlsx") {
    const matrix = await readXlsxFile(file.buffer);

    return buildScheduleDataFromMatrix({
      sheetName: "Schedule",
      matrix: matrix.map((row) => row.map(normalizeScheduleCellValue)),
    });
  }

  throw new HttpError(400, "Only XLSX and CSV schedule files are supported.");
};

const parseEditableScheduleData = (value) => {
  if (value === undefined) {
    return undefined;
  }

  let schedule;
  try {
    schedule = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new HttpError(400, "Schedule data must be valid JSON.");
  }

  if (schedule === null) {
    return null;
  }

  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    throw new HttpError(400, "Schedule data must be a valid schedule object.");
  }

  const sheetName = normalizeText(schedule.sheetName || "Tournament Schedule").slice(0, 120);
  if (!Array.isArray(schedule.headers) || schedule.headers.length === 0 || schedule.headers.length > 12) {
    throw new HttpError(400, "A schedule must have between 1 and 12 columns.");
  }

  const headers = schedule.headers.map((header) => normalizeText(header).slice(0, 60));
  if (headers.some((header) => !header)) {
    throw new HttpError(400, "Schedule column names cannot be empty.");
  }

  if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) {
    throw new HttpError(400, "Schedule column names must be unique.");
  }

  if (!Array.isArray(schedule.rows) || schedule.rows.length > 500) {
    throw new HttpError(400, "A schedule can contain up to 500 rows.");
  }

  const rows = schedule.rows
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new HttpError(400, "Every schedule row must be a valid object.");
      }

      return Object.fromEntries(
        headers.map((header) => [header, String(row[header] ?? "").trim().slice(0, 300)])
      );
    })
    .filter((row) => headers.some((header) => row[header].length > 0));

  return { sheetName, headers, rows };
};

module.exports = {
  buildScheduleData,
  parseEditableScheduleData,
};
