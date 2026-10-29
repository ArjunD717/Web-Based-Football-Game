// packages/shared/src/math/rng.test.ts
import { describe, expect, it } from "vitest";
import { createRng } from "./rng";

describe("createRng", () => {
  it("produces the pinned mulberry32 sequence for a seed", () => {
    const rng = createRng(12345);
    const draws = Array.from({ length: 6 }, () => rng.next());
    expect(draws).toEqual([
      0.9797282677609473, 0.3067522644996643, 0.484205421525985,
      0.817934412509203, 0.5094283693470061, 0.34747186047025025,
    ]);
  });

  it("is reproducible from the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 32 }, () => a.next())).toEqual(
      Array.from({ length: 32 }, () => b.next()),
    );
  });

  it("differs across seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(Array.from({ length: 8 }, () => a.next())).not.toEqual(
      Array.from({ length: 8 }, () => b.next()),
    );
  });

  it("normalizes negative seeds into uint32 space", () => {
    expect(createRng(-1).seed).toBe(4_294_967_295);
  });

  it("rejects non-integer seeds", () => {
    expect(() => createRng(1.5)).toThrow(RangeError);
  });
});

describe("uniform draws", () => {
  it("stays in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("returns integers in the half-open range and covers both ends", () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const value = rng.int(1, 4);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThan(4);
      seen.add(value);
    }
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it("rejects invalid integer bounds", () => {
    const rng = createRng(1);
    expect(() => rng.int(3, 3)).toThrow(RangeError);
    expect(() => rng.int(4, 3)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
  });

  it("returns reals within [min, max)", () => {
    const rng = createRng(123);
    for (let i = 0; i < 1_000; i += 1) {
      const value = rng.range(-2, 3);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThan(3);
    }
    expect(rng.range(5, 5)).toBe(5);
  });

  it("rejects invalid real ranges", () => {
    const rng = createRng(1);
    expect(() => rng.range(5, 4)).toThrow(RangeError);
    expect(() => rng.range(Number.NaN, 4)).toThrow(RangeError);
  });

  it("honours the deterministic probability boundaries", () => {
    const rng = createRng(5);
    expect(Array.from({ length: 100 }, () => rng.chance(0))).toEqual(
      Array.from({ length: 100 }, () => false),
    );
    expect(Array.from({ length: 100 }, () => rng.chance(1))).toEqual(
      Array.from({ length: 100 }, () => true),
    );
    expect(() => rng.chance(1.1)).toThrow(RangeError);
  });

  it("picks elements from a collection and rejects an empty one", () => {
    const rng = createRng(6);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 100; i += 1) {
      expect(items).toContain(rng.pick(items));
    }
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});
