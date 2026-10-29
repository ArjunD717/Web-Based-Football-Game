// packages/data-tools/src/names.test.ts

import { createRng } from "@fb/shared";
import { describe, expect, it } from "vitest";
import {
  isPronounceableName,
  mutateNames,
  nameMutationInternals,
  normalizeName,
} from "./names";

const noNames = new Set<string>();

describe("name mutation", () => {
  it("is deterministic and keeps the first name", () => {
    const source = [{ id: "player-1", realName: "Harry Kane" }];
    const first = mutateNames(source, {
      forbiddenNames: new Set(["harry kane"]),
    });
    const second = mutateNames(source, {
      forbiddenNames: new Set(["harry kane"]),
    });
    expect(first).toEqual(second);
    expect(first[0]?.name.startsWith("Harry ")).toBe(true);
    expect(normalizeName(first[0]?.name ?? "")).not.toBe("harry kane");
    expect(first[0]?.name).not.toBe("Harry Kane");
  });

  it("supports all four strategy families without changing length for letters", () => {
    const phonetic = nameMutationInternals.mutatePhonetic(
      "Kane",
      createRng(11),
      false,
    );
    expect(phonetic).not.toBe("Kane");
    expect(phonetic).toHaveLength(4);

    const vowel = nameMutationInternals.mutateVowels("Messi", createRng(12));
    expect(vowel).not.toBe("Messi");
    expect(vowel).toHaveLength(5);

    const cluster = nameMutationInternals.mutateCluster("Mbappe", createRng(13));
    expect(cluster.startsWith("Mbappe")).toBe(true);
    expect(cluster.length).toBeGreaterThan("Mbappe".length);
    expect(nameMutationInternals.mutatePun("Kane")).toBe("Lame");
  });

  it("preserves diacritics while shifting vowels", () => {
    const mutated = nameMutationInternals.mutateVowels("Müller", createRng(14));
    expect(mutated).not.toBe("Müller");
    expect(mutated).toHaveLength(6);
    expect(mutated.normalize("NFD")).toContain("\u0308");
  });

  it("applies hand-picked overrides", () => {
    const result = mutateNames([{ id: "p1", realName: "Harry Kane" }], {
      forbiddenNames: new Set(["harry kane"]),
      overrides: new Map([["p1", "Harry Lame"]]),
    });
    expect(result[0]).toMatchObject({
      name: "Harry Lame",
      strategy: "override",
      attempts: 0,
    });
  });

  it("rejects overrides that duplicate a source name or contain blocked text", () => {
    expect(() =>
      mutateNames([{ id: "p1", realName: "Harry Kane" }], {
        forbiddenNames: new Set(["harry kane"]),
        overrides: new Map([["p1", "Harry Kane"]]),
      }),
    ).toThrow(/invalid or duplicates/);
    expect(() =>
      mutateNames([{ id: "p1", realName: "Harry Kane" }], {
        forbiddenNames: new Set(["harry kane"]),
        overrides: new Map([["p1", "Fuck"]]) ,
      }),
    ).toThrow(/invalid or duplicates/);
  });

  it("enforces global uniqueness for duplicate source names", () => {
    const result = mutateNames(
      [
        { id: "p1", realName: "Harry Kane" },
        { id: "p2", realName: "Harry Kane" },
      ],
      { forbiddenNames: new Set(["harry kane"]) },
    );
    expect(result).toHaveLength(2);
    expect(new Set(result.map((entry) => normalizeName(entry.name))).size).toBe(2);
  });

  it("rejects unpronounceable candidates", () => {
    expect(isPronounceableName("Aaaa")).toBe(false);
    expect(isPronounceableName("Bcdfg")).toBe(false);
    expect(isPronounceableName("123")).toBe(false);
    expect(isPronounceableName("Aiden")).toBe(true);
  });

  it("logs an accepted mutation for every source", () => {
    const sources = [
      { id: "a", realName: "Aiden Alder" },
      { id: "b", realName: "Bram Brook" },
      { id: "c", realName: "Corin Crest" },
    ];
    const result = mutateNames(sources, { forbiddenNames: noNames });
    expect(result.map((entry) => entry.playerId)).toEqual(["a", "b", "c"]);
    for (const entry of result) {
      expect(entry.attempts).toBeGreaterThan(0);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });
});
