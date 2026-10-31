// packages/client/src/input/bindings.ts
import {
  DEFAULT_KEY_BINDINGS,
  type ControlAction,
  type KeyBindings,
} from "./desktop-controls";

const ACTIONS = Object.keys(DEFAULT_KEY_BINDINGS) as ControlAction[];

export function cloneBindings(source: KeyBindings): KeyBindings {
  return Object.fromEntries(
    ACTIONS.map((action) => [action, [...source[action]]]),
  ) as unknown as KeyBindings;
}

/**
 * Remove duplicate physical keys from loaded/custom bindings and guarantee
 * every action keeps at least one usable key. A conflict is otherwise invisible
 * until a control appears "dead" in a match.
 */
export function sanitizeBindings(source: KeyBindings): KeyBindings {
  const used = new Set<string>();
  const next = {} as Record<ControlAction, readonly string[]>;
  for (const action of ACTIONS) {
    const codes: string[] = [];
    for (const code of source[action]) {
      if (!used.has(code) && !codes.includes(code)) {
        codes.push(code);
        used.add(code);
      }
    }
    const fallback = pickFallback(action, used);
    if (codes.length === 0 && fallback !== null) {
      codes.push(fallback);
      used.add(fallback);
    }
    next[action] = codes;
  }
  return next as KeyBindings;
}

/** Assign one captured key while keeping every other action bindable. */
export function applyBinding(
  source: KeyBindings,
  action: ControlAction,
  code: string,
): KeyBindings {
  const next = cloneBindings(source) as Record<
    ControlAction,
    readonly string[]
  >;
  for (const other of ACTIONS) {
    if (other !== action) {
      next[other] = next[other].filter((bound) => bound !== code);
    }
  }

  const used = new Set<string>();
  for (const other of ACTIONS) {
    if (other !== action) {
      for (const bound of next[other]) {
        used.add(bound);
      }
    }
  }
  for (const other of ACTIONS) {
    if (other === action || next[other].length > 0) {
      continue;
    }
    const fallback = pickFallback(other, used, code);
    if (fallback !== null) {
      next[other] = [fallback];
      used.add(fallback);
    }
  }
  next[action] = [code];
  return next as KeyBindings;
}

function pickFallback(
  action: ControlAction,
  used: ReadonlySet<string>,
  excluded?: string,
): string | null {
  for (const code of DEFAULT_KEY_BINDINGS[action]) {
    if (code !== excluded && !used.has(code)) {
      return code;
    }
  }
  return null;
}
