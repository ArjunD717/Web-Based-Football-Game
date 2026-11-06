// packages/client/src/render/asset-budget.ts

export type AuthoredAssetKind = "match" | "low";

export interface AuthoredAssetBudget {
  readonly maxCompressedBytes: Readonly<Record<AuthoredAssetKind, number>>;
  readonly maxTriangles: Readonly<Record<AuthoredAssetKind, number>>;
  readonly maxBones: number;
}

/** Values are conservative ceilings, not targets. */
export const AUTHORED_ASSET_BUDGET: AuthoredAssetBudget = {
  maxCompressedBytes: {
    match: 1_000_000,
    low: 900_000,
  },
  maxTriangles: {
    match: 8_000,
    low: 4_000,
  },
  maxBones: 64,
};

export interface AuthoredAssetStats {
  readonly kind: AuthoredAssetKind;
  readonly compressedBytes: number | null;
  readonly triangles: number;
  readonly bones: number;
}

export function authoredAssetBudgetIssues(
  stats: AuthoredAssetStats,
  budget: AuthoredAssetBudget = AUTHORED_ASSET_BUDGET,
): readonly string[] {
  const issues: string[] = [];
  if (
    stats.compressedBytes !== null &&
    stats.compressedBytes > budget.maxCompressedBytes[stats.kind]
  ) {
    issues.push(
      `${stats.kind} is ${stats.compressedBytes} bytes; budget is ${budget.maxCompressedBytes[stats.kind]}`,
    );
  }
  if (stats.triangles > budget.maxTriangles[stats.kind]) {
    issues.push(
      `${stats.kind} has ${stats.triangles} triangles; budget is ${budget.maxTriangles[stats.kind]}`,
    );
  }
  if (stats.bones > budget.maxBones) {
    issues.push(
      `${stats.kind} has ${stats.bones} bones; budget is ${budget.maxBones}`,
    );
  }
  return issues;
}
