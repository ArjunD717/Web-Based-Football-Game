// packages/client/src/render/foot-ik.test.ts

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createFootLockState,
  resetFootLock,
  solveTwoBoneIk,
  updateFootLock,
  type FootLockTuning,
} from "./foot-ik";

const tuning: FootLockTuning = {
  contactEnterM: 0.04,
  contactExitM: 0.09,
  maxPlantTravelM: 1.1,
};

describe("two-bone IK", () => {
  it("keeps both segment lengths and bends the knee toward the pole", () => {
    const hip = new THREE.Vector3(0, 1.0, 0);
    const target = new THREE.Vector3(0, 0.2, 0);
    const solution = solveTwoBoneIk({
      hip,
      target,
      pole: new THREE.Vector3(0, 0, 1),
      upperLengthM: 0.45,
      lowerLengthM: 0.45,
    });
    expect(solution.reachable).toBe(true);
    expect(solution.ankle.distanceTo(target)).toBeCloseTo(0);
    expect(solution.knee.distanceTo(hip)).toBeCloseTo(0.45);
    expect(solution.knee.distanceTo(solution.ankle)).toBeCloseTo(0.45);
    expect(solution.knee.z).toBeGreaterThan(0);
  });

  it("clamps an unreachable target and reports it", () => {
    const hip = new THREE.Vector3(0, 1, 0);
    const solution = solveTwoBoneIk({
      hip,
      target: new THREE.Vector3(0, -2, 0),
      pole: new THREE.Vector3(0, 0, 1),
      upperLengthM: 0.4,
      lowerLengthM: 0.4,
      reachMarginM: 0.01,
    });
    expect(solution.reachable).toBe(false);
    expect(solution.ankle.distanceTo(hip)).toBeLessThanOrEqual(0.79 + 1e-6);
    expect(solution.knee.distanceTo(hip)).toBeCloseTo(0.4);
    expect(solution.knee.distanceTo(solution.ankle)).toBeCloseTo(0.4);
  });

  it("handles a target inside the minimum reach and a degenerate pole", () => {
    const solution = solveTwoBoneIk({
      hip: new THREE.Vector3(0, 1, 0),
      target: new THREE.Vector3(0, 1, 0),
      pole: new THREE.Vector3(0, 1, 0),
      upperLengthM: 0.4,
      lowerLengthM: 0.4,
    });
    expect(solution.reachable).toBe(false);
    expect(Number.isFinite(solution.knee.x)).toBe(true);
    expect(Number.isFinite(solution.knee.y)).toBe(true);
    expect(Number.isFinite(solution.ankle.y)).toBe(true);
  });

  it("uses the pole to choose the bend plane instead of the shortest arc", () => {
    const hip = new THREE.Vector3(0, 1, 0);
    const target = new THREE.Vector3(0.25, 0.2, 0);
    const forward = solveTwoBoneIk({
      hip,
      target,
      pole: new THREE.Vector3(0, 0, 1),
      upperLengthM: 0.5,
      lowerLengthM: 0.5,
    });
    const side = solveTwoBoneIk({
      hip,
      target,
      pole: new THREE.Vector3(1, 0, 0),
      upperLengthM: 0.5,
      lowerLengthM: 0.5,
    });
    expect(forward.knee.z).toBeGreaterThan(side.knee.z);
    expect(side.knee.x).toBeGreaterThan(forward.knee.x);
  });
});

describe("world-space foot lock", () => {
  it("locks a low foot and holds its world position while the hip moves", () => {
    const state = createFootLockState();
    const ankle = new THREE.Vector3(0.2, 0.02, 0.4);
    const first = updateFootLock(
      state,
      {
        ankle,
        hip: new THREE.Vector3(0.2, 1, 0.4),
        targetY: 0,
        maxReachM: 2,
        grounded: true,
      },
      tuning,
    );
    expect(first?.justLocked).toBe(true);
    expect(first?.position.x).toBeCloseTo(0.2);
    expect(first?.position.z).toBeCloseTo(0.4);

    ankle.set(0.28, 0.01, 0.52);
    const second = updateFootLock(
      state,
      {
        ankle,
        hip: new THREE.Vector3(0.3, 1, 0.55),
        targetY: 0,
        maxReachM: 2,
        grounded: true,
      },
      tuning,
    );
    expect(second?.justLocked).toBe(false);
    expect(second?.position.x).toBeCloseTo(0.2);
    expect(second?.position.z).toBeCloseTo(0.4);
    expect(second?.position.y).toBe(0);
  });

  it("does not lock a raised swing foot", () => {
    const state = createFootLockState();
    expect(
      updateFootLock(
        state,
        {
          ankle: new THREE.Vector3(0, 0.2, 0),
          hip: new THREE.Vector3(0, 1, 0),
          targetY: 0,
          maxReachM: 2,
          grounded: true,
        },
        tuning,
      ),
    ).toBeNull();
  });

  it("releases on lift, travel beyond the plant, or going airborne", () => {
    const state = createFootLockState();
    const base = {
      ankle: new THREE.Vector3(0, 0, 0),
      hip: new THREE.Vector3(0, 1, 0),
      targetY: 0,
      maxReachM: 2,
      grounded: true,
    };
    updateFootLock(state, base, tuning);

    expect(
      updateFootLock(
        state,
        { ...base, ankle: new THREE.Vector3(0, 0.12, 0) },
        tuning,
      )?.justReleased,
    ).toBe(true);
    expect(state.locked).toBe(false);

    updateFootLock(state, base, tuning);
    expect(
      updateFootLock(
        state,
        { ...base, hip: new THREE.Vector3(1.2, 1, 0) },
        tuning,
      )?.justReleased,
    ).toBe(true);

    updateFootLock(state, base, tuning);
    expect(
      updateFootLock(
        state,
        { ...base, grounded: false },
        tuning,
      ),
    ).toBeNull();
    expect(state.locked).toBe(false);
  });

  it("never acquires a contact the leg cannot reach", () => {
    const state = createFootLockState();
    expect(
      updateFootLock(
        state,
        {
          ankle: new THREE.Vector3(1.5, 0, 0),
          hip: new THREE.Vector3(0, 1, 0),
          targetY: 0,
          maxReachM: 1.1,
          grounded: true,
        },
        tuning,
      ),
    ).toBeNull();
    expect(state.locked).toBe(false);
  });

  it("releases a contact explicitly on rewind or a teleport", () => {
    const state = createFootLockState();
    updateFootLock(
      state,
      {
        ankle: new THREE.Vector3(),
        hip: new THREE.Vector3(0, 1, 0),
        targetY: 0,
        maxReachM: 2,
        grounded: true,
      },
      tuning,
    );
    expect(state.locked).toBe(true);
    resetFootLock(state);
    expect(state.locked).toBe(false);
    expect(state.anchor.lengthSq()).toBe(0);
  });
});
