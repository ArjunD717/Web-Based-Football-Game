// packages/client/src/render/asset-budget.test.ts

import { describe, expect, it } from "vitest";
import {
  AUTHORED_ASSET_BUDGET,
  authoredAssetBudgetIssues,
  type AuthoredAssetStats,
} from "./asset-budget";

const stats: AuthoredAssetStats = {
  kind: "low",
  compressedBytes: 804_312,
  triangles: 3_491,
  bones: 53,
};

describe("authored asset budget", () => {
  it("accepts the shipped low template", () => {
    expect(authoredAssetBudgetIssues(stats)).toEqual([]);
  });

  it("reports each exceeded dimension", () => {
    const issues = authoredAssetBudgetIssues({
      ...stats,
      compressedBytes: AUTHORED_ASSET_BUDGET.maxCompressedBytes.low + 1,
      triangles: AUTHORED_ASSET_BUDGET.maxTriangles.low + 1,
      bones: AUTHORED_ASSET_BUDGET.maxBones + 1,
    });
    expect(issues).toHaveLength(3);
    expect(issues.join("\n")).toContain("bytes");
    expect(issues.join("\n")).toContain("triangles");
    expect(issues.join("\n")).toContain("bones");
  });

  it("ignores unknown compressed sizes instead of failing closed", () => {
    expect(
      authoredAssetBudgetIssues({ ...stats, compressedBytes: null }),
    ).toEqual([]);
  });
});
