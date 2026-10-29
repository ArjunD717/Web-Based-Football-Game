// packages/data-tools/src/csv.ts

/** RFC 4180-style CSV reader with explicit header validation. */

export type CsvRecord = Readonly<Record<string, string>>;

export interface ParsedCsv {
  readonly headers: readonly string[];
  readonly records: readonly CsvRecord[];
}

export function parseCsvText(text: string, source = "CSV"): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;

  const endField = (): void => {
    row.push(field.trim());
    field = "";
    quotedField = false;
  };

  const endRow = (): void => {
    endField();
    // Ignore blank separators at the end of a file and fully blank lines.
    if (row.some((value) => value !== "")) {
      rows.push(row);
    }
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.trim() !== "" || quotedField) {
        throw new SyntaxError(
          `${source}: unexpected quote at character ${index + 1}`,
        );
      }
      inQuotes = true;
      quotedField = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r") {
      if (input[index + 1] === "\n") {
        index += 1;
      }
      endRow();
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new SyntaxError(`${source}: unterminated quoted field`);
  }
  if (field !== "" || row.length > 0) {
    endRow();
  }

  return rows;
}

export function parseCsvRecords(
  text: string,
  expectedHeaders: readonly string[],
  source = "CSV",
): ParsedCsv {
  const rows = parseCsvText(text, source);
  const first = rows[0];
  if (first === undefined) {
    throw new Error(`${source}: file is empty`);
  }

  const headers = first.map((header) => header.trim());
  if (headers.some((header) => header === "")) {
    throw new Error(`${source}: header contains an empty column name`);
  }
  const duplicate = headers.find(
    (header, index) => headers.indexOf(header) !== index,
  );
  if (duplicate !== undefined) {
    throw new Error(`${source}: duplicate header "${duplicate}"`);
  }

  const expected = new Set(expectedHeaders);
  const unexpected = headers.filter((header) => !expected.has(header));
  const missing = expectedHeaders.filter((header) => !headers.includes(header));
  if (unexpected.length > 0 || missing.length > 0) {
    const details = [
      missing.length > 0 ? `missing [${missing.join(", ")}]` : "",
      unexpected.length > 0 ? `unexpected [${unexpected.join(", ")}]` : "",
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(`${source}: header mismatch: ${details}`);
  }

  const records = rows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(
        `${source}: row ${rowIndex + 2} has ${values.length} fields, expected ${headers.length}`,
      );
    }
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });

  return { headers, records };
}
