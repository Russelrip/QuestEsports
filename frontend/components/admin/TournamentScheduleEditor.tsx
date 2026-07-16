"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminTournamentBracket } from "@/lib/admin";
import type { TournamentScheduleData } from "@/lib/tournaments";
import { ADMIN_UPLOAD_MAX_FILE_SIZE } from "@/lib/upload-limits";

const DEFAULT_HEADERS = ["Date", "Match", "Team A", "Team B", "Time", "Format"];

const createSchedule = (tournamentTitle: string): TournamentScheduleData => ({
  sheetName: `${tournamentTitle.trim() || "Tournament"} Schedule`,
  headers: [...DEFAULT_HEADERS],
  rows: [],
});

const cellText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
};

const makeUniqueHeaders = (values: unknown[]) => {
  const used = new Set<string>();

  return values.map((value, index) => {
    const base = cellText(value) || `Column ${index + 1}`;
    let header = base;
    let suffix = 2;
    while (used.has(header.toLowerCase())) {
      header = `${base} ${suffix}`;
      suffix += 1;
    }
    used.add(header.toLowerCase());
    return header;
  });
};

const matrixToSchedule = (
  matrix: unknown[][],
  tournamentTitle: string
): TournamentScheduleData => {
  const nonEmptyRows = matrix.filter(
    (row) => Array.isArray(row) && row.some((cell) => cellText(cell).length > 0)
  );

  if (nonEmptyRows.length === 0) {
    throw new Error("The selected schedule file is empty.");
  }

  const headers = makeUniqueHeaders(nonEmptyRows[0]);
  if (headers.length > 12) {
    throw new Error("Schedules can contain up to 12 columns.");
  }

  const rows = nonEmptyRows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, cellText(row[index])]))
  );

  if (rows.length > 500) {
    throw new Error("Schedules can contain up to 500 rows.");
  }

  return {
    sheetName: `${tournamentTitle.trim() || "Tournament"} Schedule`,
    headers,
    rows,
  };
};

const parseCsvMatrix = (source: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
};

const readScheduleFile = async (file: File, tournamentTitle: string) => {
  if (file.size > ADMIN_UPLOAD_MAX_FILE_SIZE) {
    throw new Error("Schedule files must be 10 MB or smaller.");
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return matrixToSchedule(parseCsvMatrix(await file.text()), tournamentTitle);
  }
  if (extension === "xlsx") {
    const { readSheet } = await import("read-excel-file/browser");
    return matrixToSchedule(await readSheet(file), tournamentTitle);
  }
  throw new Error("Choose an XLSX or CSV schedule file.");
};

const headerKind = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

const buildAutomaticRow = (schedule: TournamentScheduleData) => {
  const previous = schedule.rows.at(-1);
  const numericMatches = schedule.rows
    .map((row) => Number.parseInt(row[schedule.headers.find((header) => headerKind(header).startsWith("match")) || ""] || "", 10))
    .filter(Number.isFinite);
  const nextMatch = numericMatches.length > 0 ? Math.max(...numericMatches) + 1 : schedule.rows.length + 1;

  return Object.fromEntries(
    schedule.headers.map((header) => {
      const kind = headerKind(header);
      if (kind.startsWith("match")) return [header, String(nextMatch)];
      if (kind === "date" || kind === "format") return [header, previous?.[header] || ""];
      return [header, ""];
    })
  );
};

const scheduleFromBracket = (
  bracket: AdminTournamentBracket,
  tournamentTitle: string,
  current?: TournamentScheduleData | null
): TournamentScheduleData => {
  const participants = new Map(
    bracket.bracketData.participant.map((participant) => [participant.id, participant.name])
  );
  const base = current || createSchedule(tournamentTitle);
  const headers = base.headers.length > 0 ? base.headers : [...DEFAULT_HEADERS];
  const matches = [...bracket.bracketData.match].sort(
    (left, right) => left.round_id - right.round_id || left.number - right.number || left.id - right.id
  );

  const opponentName = (id: number | null | undefined) =>
    id === null || id === undefined ? "TBD" : participants.get(id) || "TBD";

  return {
    ...base,
    rows: matches.map((match, index) =>
      Object.fromEntries(
        headers.map((header) => {
          const kind = headerKind(header);
          if (kind.startsWith("match")) return [header, String(index + 1)];
          if (kind === "teama" || kind === "team1") return [header, opponentName(match.opponent1?.id)];
          if (kind === "teamb" || kind === "team2") return [header, opponentName(match.opponent2?.id)];
          if (kind === "format") return [header, current?.rows[index]?.[header] || "Bo1"];
          return [header, current?.rows[index]?.[header] || ""];
        })
      )
    ),
  };
};

function ScheduleHeaderInput({
  index,
  value,
  onCommit,
}: {
  index: number;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(value);

  return (
    <Input
      aria-label={`Column ${index + 1} name`}
      value={draftValue}
      maxLength={60}
      className="h-9 min-w-28 rounded-lg bg-black/20 px-3 text-xs font-semibold uppercase"
      onChange={(event) => setDraftValue(event.target.value)}
      onBlur={() => onCommit(draftValue)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export default function TournamentScheduleEditor({
  tournamentTitle,
  schedule,
  file,
  bracket,
  onScheduleChange,
  onFileChange,
  onRemove,
}: {
  tournamentTitle: string;
  schedule: TournamentScheduleData | null;
  file: File | null;
  bracket: AdminTournamentBracket | null;
  onScheduleChange: (schedule: TournamentScheduleData) => void;
  onFileChange: (file: File | null) => void;
  onRemove: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const draft = schedule || createSchedule(tournamentTitle);

  const updateHeader = (index: number, requestedHeader: string) => {
    const oldHeader = draft.headers[index];
    const base = requestedHeader.trim() || `Column ${index + 1}`;
    const siblingHeaders = new Set(
      draft.headers.filter((_, headerIndex) => headerIndex !== index).map((header) => header.toLowerCase())
    );
    let nextHeader = base;
    let suffix = 2;
    while (siblingHeaders.has(nextHeader.toLowerCase())) {
      nextHeader = `${base} ${suffix}`;
      suffix += 1;
    }

    onScheduleChange({
      ...draft,
      headers: draft.headers.map((header, headerIndex) => headerIndex === index ? nextHeader : header),
      rows: draft.rows.map((row) => {
        const nextRow = { ...row, [nextHeader]: row[oldHeader] || "" };
        if (oldHeader !== nextHeader) delete nextRow[oldHeader];
        return nextRow;
      }),
    });
  };

  const updateCell = (rowIndex: number, header: string, value: string) => {
    onScheduleChange({
      ...draft,
      rows: draft.rows.map((row, index) => index === rowIndex ? { ...row, [header]: value } : row),
    });
  };

  const moveRow = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.rows.length) return;
    const rows = [...draft.rows];
    [rows[index], rows[nextIndex]] = [rows[nextIndex], rows[index]];
    onScheduleChange({ ...draft, rows });
  };

  const removeRow = (index: number) => {
    onScheduleChange({ ...draft, rows: draft.rows.filter((_, rowIndex) => rowIndex !== index) });
  };

  const addColumn = () => {
    if (draft.headers.length >= 12) return;
    const header = makeUniqueHeaders([...draft.headers, `Column ${draft.headers.length + 1}`]).at(-1) || "Column";
    onScheduleChange({
      ...draft,
      headers: [...draft.headers, header],
      rows: draft.rows.map((row) => ({ ...row, [header]: "" })),
    });
  };

  const removeColumn = (index: number) => {
    if (draft.headers.length <= 1) return;
    const removedHeader = draft.headers[index];
    onScheduleChange({
      ...draft,
      headers: draft.headers.filter((_, headerIndex) => headerIndex !== index),
      rows: draft.rows.map((row) => {
        const nextRow = { ...row };
        delete nextRow[removedHeader];
        return nextRow;
      }),
    });
  };

  const importFile = async (selectedFile: File | null) => {
    onFileChange(selectedFile);
    if (!selectedFile) return;
    setImporting(true);
    setImportError("");
    try {
      onScheduleChange(await readScheduleFile(selectedFile, tournamentTitle));
    } catch (error) {
      onFileChange(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setImportError(error instanceof Error ? error.message : "Unable to read the schedule file.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="md:col-span-2 xl:col-span-3 rounded-[24px] border border-white/10 bg-black/20 p-4 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Schedule Builder</p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
            Import XLSX/CSV to fill the grid automatically, generate rows from the native bracket, or edit every value manually.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {bracket ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => onScheduleChange(scheduleFromBracket(bracket, tournamentTitle, schedule))}>
              Generate from Bracket
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="secondary" onClick={() => onScheduleChange({ ...draft, rows: [...draft.rows, buildAutomaticRow(draft)] })}>
            Add Match
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={draft.headers.length >= 12} onClick={addColumn}>
            Add Column
          </Button>
          {schedule || file ? (
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => {
                onRemove();
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              Clear Schedule
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
        <label className="grid gap-2 text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
          Public schedule title
          <Input
            value={draft.sheetName}
            maxLength={120}
            onChange={(event) => onScheduleChange({ ...draft, sheetName: event.target.value })}
            placeholder={`${tournamentTitle || "Tournament"} Schedule`}
          />
        </label>
        <label className="grid gap-2 text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
          Import spreadsheet · XLSX or CSV · max 10 MB
          <Input
            key={file?.name || "empty-schedule-file"}
            ref={fileInputRef}
            id="scheduleFile"
            type="file"
            accept=".xlsx,.csv"
            disabled={importing}
            onChange={(event) => void importFile(event.target.files?.[0] || null)}
          />
        </label>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {importing
          ? "Reading schedule..."
          : file
            ? `${file.name} imported — review the grid, then save the tournament.`
            : schedule?.rows.length
              ? `${schedule.rows.length} editable schedule rows.`
              : "No matches yet. Add a match, import a file, or generate from a bracket."}
      </p>
      {importError ? <p className="mt-2 text-xs text-rose-300">{importError}</p> : null}

      <div className="mt-5 overflow-x-auto border border-white/10">
        <table className="min-w-[920px] w-full text-left text-xs">
          <thead className="bg-[#263451]">
            <tr>
              {draft.headers.map((header, index) => (
                <th key={index} className="min-w-32 p-2 align-top">
                  <ScheduleHeaderInput key={header} index={index} value={header} onCommit={(value) => updateHeader(index, value)} />
                  {draft.headers.length > 1 ? (
                    <button type="button" className="mt-1 text-[10px] font-normal text-slate-400 hover:text-rose-200" onClick={() => removeColumn(index)}>
                      Remove column
                    </button>
                  ) : null}
                </th>
              ))}
              <th className="w-32 p-2 text-right font-semibold uppercase text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-white/8 odd:bg-[#33415f]/70 even:bg-[#202d4b]/80">
                {draft.headers.map((header) => (
                  <td key={header} className="p-2">
                    <Input
                      aria-label={`${header}, row ${rowIndex + 1}`}
                      value={row[header] || ""}
                      maxLength={300}
                      className="h-9 min-w-28 rounded-lg border-white/5 bg-black/15 px-3 text-xs"
                      onChange={(event) => updateCell(rowIndex, header, event.target.value)}
                    />
                  </td>
                ))}
                <td className="p-2">
                  <div className="flex justify-end gap-1">
                    <button type="button" aria-label={`Move row ${rowIndex + 1} up`} disabled={rowIndex === 0} className="h-8 w-8 border border-white/10 text-slate-300 disabled:opacity-30" onClick={() => moveRow(rowIndex, -1)}>↑</button>
                    <button type="button" aria-label={`Move row ${rowIndex + 1} down`} disabled={rowIndex === draft.rows.length - 1} className="h-8 w-8 border border-white/10 text-slate-300 disabled:opacity-30" onClick={() => moveRow(rowIndex, 1)}>↓</button>
                    <button type="button" aria-label={`Delete row ${rowIndex + 1}`} className="h-8 px-2 border border-rose-400/20 text-rose-200" onClick={() => removeRow(rowIndex)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {draft.rows.length === 0 ? (
          <p className="bg-[#202d4b]/60 px-4 py-8 text-center text-sm text-slate-400">Schedule rows will appear here.</p>
        ) : null}
      </div>
    </div>
  );
}
