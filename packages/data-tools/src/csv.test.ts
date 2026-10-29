// packages/data-tools/src/csv.test.ts

import { describe, expect, it } from "vitest";
import { parseCsvRecords, parseCsvText } from "./csv";

const HEADERS = ["player_id", "name", "note"] as const;

describe("CSV parser", () => {
  it("handles quoted commas, escaped quotes, newlines and CRLF", () => {
    const rows = parseCsvText(
      'id,name,note\r\n1,"Alder, Aiden","He said ""hello""\nnext line"\r\n2,Bram,plain\r\n',
    );
    expect(rows).toEqual([
      ["id", "name", "note"],
      ["1", "Alder, Aiden", 'He said "hello"\nnext line'],
      ["2", "Bram", "plain"],
    ]);
  });

  it("strips a UTF-8 BOM and ignores blank trailing rows", () => {
    const rows = parseCsvText("\ufeffid,name,note\n1,Aiden,x\n\n");
    expect(rows).toEqual([
      ["id", "name", "note"],
      ["1", "Aiden", "x"],
    ]);
  });

  it("maps validated headers onto records", () => {
    const parsed = parseCsvRecords(
      "player_id,name,note\np1,Aiden,ok\n",
      HEADERS,
      "players.csv",
    );
    expect(parsed.records).toEqual([
      { player_id: "p1", name: "Aiden", note: "ok" },
    ]);
  });

  it("rejects missing and unexpected headers", () => {
    expect(() =>
      parseCsvRecords("player_id,name\np1,Aiden\n", HEADERS, "players.csv"),
    ).toThrow(/missing \[note\]/);
    expect(() =>
      parseCsvRecords(
        "player_id,name,note,extra\np1,Aiden,ok,x\n",
        HEADERS,
        "players.csv",
      ),
    ).toThrow(/unexpected \[extra\]/);
  });

  it("rejects duplicate headers, ragged rows and unterminated quotes", () => {
    expect(() =>
      parseCsvRecords(
        "player_id,name,note,note\np1,Aiden,ok,x\n",
        [...HEADERS, "note"],
        "players.csv",
      ),
    ).toThrow(/duplicate header "note"/);
    expect(() =>
      parseCsvRecords("player_id,name,note\np1,Aiden\n", HEADERS, "players.csv"),
    ).toThrow(/row 2 has 2 fields/);
    expect(() => parseCsvText('id,name\n1,"Aiden\n')).toThrow(
      /unterminated quoted field/,
    );
  });
});
