import { describe, it, expect } from "vitest";
import {
  shouldIncludeWorkingDirectoryDiscipline,
  renderWorkingDirectoryDisciplineSection,
  renderNoImplementationRootWarning,
  renderRecoveryDisciplineSection,
} from "../../src/workflow/agent-operating-discipline.js";

describe("shouldIncludeWorkingDirectoryDiscipline", () => {
  it("is false when existingRepositoryPath is not configured", () => {
    expect(
      shouldIncludeWorkingDirectoryDiscipline({
        controlRoot: "/home/user/aiqt-project",
        existingRepositoryPath: null,
      }),
    ).toBe(false);
  });

  it("is true when existingRepositoryPath differs from the control root", () => {
    expect(
      shouldIncludeWorkingDirectoryDiscipline({
        controlRoot: "/home/user/aiqt-project",
        existingRepositoryPath: "/home/user/actual-app",
      }),
    ).toBe(true);
  });

  it("is false when existingRepositoryPath resolves to the same folder as the control root", () => {
    expect(
      shouldIncludeWorkingDirectoryDiscipline({
        controlRoot: "/home/user/project",
        existingRepositoryPath: "/home/user/project",
      }),
    ).toBe(false);
  });
});

describe("renderWorkingDirectoryDisciplineSection", () => {
  it("renders the correct control root and implementation root", () => {
    const section = renderWorkingDirectoryDisciplineSection({
      controlRoot: "/home/user/aiqt-project",
      existingRepositoryPath: "/home/user/actual-app",
    });
    expect(section).toContain("## Working Directory Discipline");
    expect(section).toContain("AIQT control root:");
    expect(section).toContain("/home/user/aiqt-project");
    expect(section).toContain("Implementation root:");
    expect(section).toContain("/home/user/actual-app");
  });

  it("includes all required rules", () => {
    const section = renderWorkingDirectoryDisciplineSection({
      controlRoot: "/root",
      existingRepositoryPath: "/impl",
    });
    expect(section).toContain("Run AIQT commands from the AIQT control root.");
    expect(section).toContain("Run application commands from the implementation root.");
    expect(section).toContain("Run browser / Playwright MCP checks from the implementation root.");
    expect(section).toContain("Do not create nested application folders under the AIQT control root.");
    expect(section).toContain(".playwright-mcp");
    expect(section).toContain("Report changed files relative to the implementation root in checkpoint output.");
  });
});

describe("renderNoImplementationRootWarning", () => {
  it("does not invent an implementation root, and states the assumption", () => {
    const warning = renderNoImplementationRootWarning("/home/user/project");
    expect(warning).toContain("No existingRepositoryPath is configured");
    expect(warning).toContain("/home/user/project");
    expect(warning).not.toContain("## Working Directory Discipline");
  });
});

describe("renderRecoveryDisciplineSection", () => {
  it("prefers M11/M12 repair controls over reset/reimport", () => {
    const section = renderRecoveryDisciplineSection();
    expect(section).toContain("aiqt issue list / update / promote");
    expect(section).toContain("aiqt dependency update");
    expect(section).toContain("aiqt graph validate");
    expect(section).toContain("aiqt graph repair --dry-run");
    expect(section).toContain("aiqt checkpoint amend");
    expect(section).toMatch(/reset\/reimport is a last resort/i);
  });
});
