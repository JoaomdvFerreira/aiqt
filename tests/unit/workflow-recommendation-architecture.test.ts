import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

describe("WU32-05 recommendation architecture guard", () => {
  it("keeps the workflow recommendation precedence table in workflow-assessment.ts", () => {
    const owners = sourceFiles(join(ROOT, "src"))
      .filter((file) => readFileSync(file, "utf8").includes("WORKFLOW_RECOMMENDATION_RULES"))
      .map((file) => relative(ROOT, file).replace(/\\/g, "/"));

    expect(owners).toEqual(["src/workflow/workflow-assessment.ts"]);
  });

  it("keeps mutation services from hard-coding persisted nextRecommendedCommand values", () => {
    const mutationServiceFiles = [
      "src/services/checkpoint-service.ts",
      "src/services/plan-extension-service.ts",
      "src/services/project-update-service.ts",
      "src/services/workflow-assessment-persistence.ts",
    ];
    const hardCodedPersistedRecommendation = /nextRecommendedCommand\s*:\s*"aiqt |nextRecommendedCommand\s*=\s*"aiqt /;

    const offenders = mutationServiceFiles.filter((file) =>
      hardCodedPersistedRecommendation.test(readFileSync(join(ROOT, file), "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
