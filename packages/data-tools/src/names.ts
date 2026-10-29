// packages/data-tools/src/names.ts

import { createRng } from "@fb/shared";
import type { Rng } from "@fb/shared";

/** Build-time-only mutation strategy labels written to the review report. */
export type MutationStrategy =
  | "override"
  | "phonetic"
  | "vowel"
  | "cluster"
  | "pun"
  | "fallback";

export interface NameSource {
  readonly id: string;
  readonly realName: string;
}

export interface MutationOptions {
  /** Original names; no generated name may equal one of these. */
  readonly forbiddenNames: ReadonlySet<string>;
  /** playerId -> hand-picked public name. */
  readonly overrides?: ReadonlyMap<string, string>;
}

export interface NameMutation {
  readonly playerId: string;
  readonly realName: string;
  readonly name: string;
  readonly strategy: MutationStrategy;
  readonly attempts: number;
}

interface Attempt {
  readonly name: string;
  readonly strategy: MutationStrategy;
}

const CONFUSIONS: Readonly<Record<string, readonly string[]>> = {
  b: ["d", "p"],
  c: ["k", "s"],
  d: ["b", "t"],
  f: ["t", "v"],
  g: ["j", "k"],
  j: ["g"],
  k: ["l", "c"],
  l: ["k", "r"],
  m: ["n"],
  n: ["m"],
  p: ["b", "f"],
  r: ["l"],
  s: ["z", "c"],
  t: ["f", "d"],
  v: ["f", "w"],
  w: ["v"],
  z: ["s"],
};

const VOWEL_SHIFT: Readonly<Record<string, string>> = {
  a: "u",
  e: "i",
  i: "e",
  o: "a",
  u: "o",
  y: "i",
};

/** Curated near-words; only used when the surname has an entry. */
const CURATED_PUNS: Readonly<Record<string, string>> = {
  kane: "lame",
  baker: "bakar",
  fisher: "fysher",
  miller: "millar",
  moore: "moor",
  smith: "smyth",
  taylor: "tayler",
  walker: "wacker",
  wright: "wrighte",
  young: "yung",
};

/**
 * Short, deliberately conservative list. Names are checked after accent
 * folding so visually altered spellings cannot slip through.
 */
const OFFENSIVE_SUBSTRINGS = [
  "asshole",
  "bastard",
  "bitch",
  "cunt",
  "fuck",
  "nazi",
  "porn",
  "rape",
  "shit",
  "slut",
  "whore",
] as const;

const MAX_ATTEMPTS = 96;

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function isVowel(base: string): boolean {
  return "aeiouy".includes(base);
}

interface Decomposed {
  readonly base: string;
  readonly marks: string;
}

function decomposeLetter(char: string): Decomposed {
  const decomposed = char.normalize("NFD");
  const base = decomposed[0] ?? char;
  return { base: base.toLowerCase(), marks: decomposed.slice(base.length) };
}

function composeLetter(base: string, marks: string, uppercase: boolean): string {
  const letter = `${base}${marks}`.normalize("NFC");
  return uppercase ? letter.toUpperCase() : letter;
}

function mapCase(source: string, replacement: string): string {
  if (source.length === 0) {
    return replacement;
  }
  if (
    source === source.toUpperCase() &&
    source !== source.toLowerCase()
  ) {
    return replacement.toUpperCase();
  }
  if (/^[A-Z]/.test(source)) {
    return `${replacement.charAt(0).toUpperCase()}${replacement.slice(1)}`;
  }
  return replacement;
}

function mutatePhonetic(
  surname: string,
  rng: Rng,
  extraChanges: boolean,
): string {
  const positions: number[] = [];
  for (let index = 0; index < surname.length; index += 1) {
    const char = surname[index] ?? "";
    if (CONFUSIONS[char.toLowerCase()] !== undefined) {
      positions.push(index);
    }
  }
  if (positions.length === 0) {
    return surname;
  }

  const changes = Math.min(
    positions.length,
    extraChanges ? 2 : 1,
  );
  const chosen = new Set<number>();
  while (chosen.size < changes) {
    chosen.add(rng.pick(positions));
  }

  const output = [...surname];
  for (const position of chosen) {
    const source = output[position] ?? "";
    const options = CONFUSIONS[source.toLowerCase()] ?? [];
    if (options.length === 0) {
      continue;
    }
    const replacement = rng.pick(options);
    output[position] = mapCase(source, replacement);
  }
  return output.join("");
}

function mutateVowels(surname: string, rng: Rng): string {
  const positions: number[] = [];
  for (let index = 0; index < surname.length; index += 1) {
    const decomposed = decomposeLetter(surname[index] ?? "");
    if (VOWEL_SHIFT[decomposed.base] !== undefined) {
      positions.push(index);
    }
  }
  if (positions.length === 0) {
    return surname;
  }

  const changes = Math.min(positions.length, rng.chance(0.35) ? 2 : 1);
  const chosen = new Set<number>();
  while (chosen.size < changes) {
    chosen.add(rng.pick(positions));
  }

  const output = [...surname];
  for (const position of chosen) {
    const source = output[position] ?? "";
    const decomposed = decomposeLetter(source);
    const target = VOWEL_SHIFT[decomposed.base];
    if (target === undefined) {
      continue;
    }
    output[position] = composeLetter(
      target,
      decomposed.marks,
      source === source.toUpperCase(),
    );
  }
  return output.join("");
}

function mutateCluster(surname: string, rng: Rng): string {
  if (surname.length < 3) {
    return surname;
  }
  const last = surname[surname.length - 1] ?? "";
  const suffix = rng.chance(0.7)
    ? "er"
    : isVowel(decomposeLetter(last).base)
      ? "n"
      : "o";
  return `${surname}${suffix}`;
}

function mutatePun(surname: string): string | null {
  const key = normalizeName(surname);
  const pun = CURATED_PUNS[key];
  if (pun === undefined) {
    return null;
  }
  return mapCase(surname, pun);
}

function applyAttempt(
  source: NameSource,
  attempt: number,
): Attempt {
  const rng = createRng(hashString(`${source.id}:${attempt}`));
  const trimmed = source.realName.trim().replace(/\s+/g, " ");
  const lastSpace = trimmed.lastIndexOf(" ");
  const first = lastSpace === -1 ? "" : trimmed.slice(0, lastSpace + 1);
  const surname = lastSpace === -1 ? trimmed : trimmed.slice(lastSpace + 1);

  const strategyRoll = rng.next();
  let strategy: MutationStrategy;
  let mutated: string;
  if (strategyRoll < 0.05) {
    const pun = mutatePun(surname);
    if (pun !== null) {
      strategy = "pun";
      mutated = pun;
    } else {
      strategy = "phonetic";
      mutated = mutatePhonetic(surname, rng, false);
    }
  } else if (strategyRoll < 0.45) {
    strategy = "phonetic";
    mutated = mutatePhonetic(surname, rng, false);
  } else if (strategyRoll < 0.73) {
    strategy = "vowel";
    mutated = mutateVowels(surname, rng);
  } else if (strategyRoll < 0.95) {
    strategy = "cluster";
    mutated = mutateCluster(surname, rng);
  } else {
    strategy = "phonetic";
    mutated = mutatePhonetic(surname, rng, true);
  }

  if (mutated === surname) {
    strategy = "fallback";
    const voweled = mutateVowels(surname, rng);
    mutated = voweled !== surname ? voweled : mutateCluster(surname, rng);
  }

  return { name: `${first}${mutated}`.trim(), strategy };
}

export function isPronounceableName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) {
    return false;
  }
  if (!/^[\p{L}][\p{L} .'-]*$/u.test(trimmed)) {
    return false;
  }
  const folded = normalizeName(trimmed);
  if (!/[aeiouy]/.test(folded)) {
    return false;
  }
  if (/(.)\1{3,}/u.test(folded)) {
    return false;
  }
  if (/q(?!u)/u.test(folded)) {
    return false;
  }
  if (/[bcdfghjklmnpqrstvwxz]{4,}/u.test(folded)) {
    return false;
  }
  const letters = folded.replace(/[^a-z]/g, "");
  if (letters.length === 0) {
    return false;
  }
  const vowels = (letters.match(/[aeiouy]/g) ?? []).length;
  const ratio = vowels / letters.length;
  return ratio >= 0.16 && ratio <= 0.78;
}

function hasOffensiveToken(name: string): boolean {
  const folded = normalizeName(name);
  return OFFENSIVE_SUBSTRINGS.some((word) => folded.includes(word));
}

function candidateIsValid(
  candidate: Attempt,
  options: MutationOptions,
  used: ReadonlySet<string>,
): boolean {
  const normalized = normalizeName(candidate.name);
  return (
    normalized.length > 0 &&
    !options.forbiddenNames.has(normalized) &&
    !used.has(normalized) &&
    !hasOffensiveToken(candidate.name) &&
    isPronounceableName(candidate.name)
  );
}

/**
 * Deterministic, order-independent mutation. Callers must sort by player ID
 * before processing so global collision resolution is reproducible.
 */
export function mutateNames(
  sources: readonly NameSource[],
  options: MutationOptions,
): readonly NameMutation[] {
  const used = new Set<string>();
  const results: NameMutation[] = [];

  for (const source of sources) {
    const override = options.overrides?.get(source.id);
    if (override !== undefined) {
      const candidate: Attempt = {
        name: override.trim().replace(/\s+/g, " "),
        strategy: "override",
      };
      if (!candidateIsValid(candidate, options, used)) {
        throw new Error(
          `Name override for ${source.id} is invalid or duplicates another name: "${override}"`,
        );
      }
      used.add(normalizeName(candidate.name));
      results.push({
        playerId: source.id,
        realName: source.realName,
        name: candidate.name,
        strategy: candidate.strategy,
        attempts: 0,
      });
      continue;
    }

    let accepted: Attempt | null = null;
    let attempts = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt + 1;
      const candidate = applyAttempt(source, attempt);
      if (candidateIsValid(candidate, options, used)) {
        accepted = candidate;
        break;
      }
    }

    // A middle initial resolves the rare case where every mutation collides
    // with an existing full name while keeping the source first name intact.
    if (accepted === null) {
      const trimmed = source.realName.trim();
      const lastSpace = trimmed.lastIndexOf(" ");
      const first = lastSpace === -1 ? "" : trimmed.slice(0, lastSpace);
      const sourceSurname = lastSpace === -1 ? trimmed : trimmed.slice(lastSpace + 1);
      const fallbackSurname = mutateCluster(
        sourceSurname,
        createRng(hashString(source.id)),
      );
      for (let letter = 0; letter < 26 && accepted === null; letter += 1) {
        const initial = String.fromCharCode(65 + letter);
        const candidate: Attempt = {
          name: `${first === "" ? "" : `${first} `}${initial}. ${fallbackSurname}`.trim(),
          strategy: "fallback",
        };
        if (candidateIsValid(candidate, options, used)) {
          accepted = candidate;
        }
      }
    }

    if (accepted === null) {
      throw new Error(`Could not generate a unique name for ${source.id}`);
    }

    used.add(normalizeName(accepted.name));
    results.push({
      playerId: source.id,
      realName: source.realName,
      name: accepted.name,
      strategy: accepted.strategy,
      attempts,
    });
  }

  return results;
}

/** Exposed for focused strategy tests; production uses `mutateNames`. */
export const nameMutationInternals = {
  mutatePhonetic,
  mutateVowels,
  mutateCluster,
  mutatePun,
} as const;
