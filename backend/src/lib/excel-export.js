const ExcelJS = require("exceljs");
const { HttpError } = require("./http-error");

const EXCEL_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_EXCEL_EXPORT_RECORDS = 5000;

const formatExportTimestamp = (value) =>
  value ? new Date(value).toISOString() : "";

const formatExportBoolean = (value) =>
  typeof value === "boolean" ? (value ? "Yes" : "No") : "";

const buildExportFilename = (prefix) => {
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}-${date}.xlsx`;
};

const addExportWorksheet = (workbook, { name, columns, rows }) => {
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = columns;
  worksheet.addRows(rows);
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: "middle", wrapText: true };

  columns.forEach((column, index) => {
    const excelColumn = worksheet.getColumn(index + 1);
    excelColumn.width = column.width || 18;
    excelColumn.alignment = { vertical: "top", wrapText: true };
  });
};

const buildExcelWorkbookBuffer = async ({ sheets }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Quest E-sports";
  workbook.created = new Date();
  workbook.modified = new Date();

  sheets.forEach((sheet) => addExportWorksheet(workbook, sheet));

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

const assertExportRecordLimit = ({ records, label }) => {
  if (records.length > MAX_EXCEL_EXPORT_RECORDS) {
    throw new HttpError(
      413,
      `${label} export is limited to ${MAX_EXCEL_EXPORT_RECORDS} records. Narrow the filters and try again.`
    );
  }
};

module.exports = {
  EXCEL_CONTENT_TYPE,
  MAX_EXCEL_EXPORT_RECORDS,
  assertExportRecordLimit,
  buildExcelWorkbookBuffer,
  buildExportFilename,
  formatExportBoolean,
  formatExportTimestamp,
};
