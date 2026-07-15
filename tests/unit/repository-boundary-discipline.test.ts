import { describe, it, expect } from "vitest";
import {
  renderRepositoryBoundaryRule,
  renderDriverSourceControlDisciplineSection,
  renderSourceControlExpectationsSection,
  renderCheckpointSourceControlGuidance,
} from "../../src/workflow/source-control-discipline.js";

describe("renderRepositoryBoundaryRule (F063)", () => {
  it("includes git rev-parse --show-toplevel and the expected-equals-implementation-root check", () => {
    const text = renderRepositoryBoundaryRule();
    expect(text).toContain("Repository Boundary Rule:");
    expect(text).toContain("git rev-parse --show-toplevel");
    expect(text).toContain("must equal the implementation root");
  });

  it("explicitly blocks parent/control-repository usage", () => {
    const text = renderRepositoryBoundaryRule();
    expect(text).toMatch(/parent folder/i);
    expect(text).toMatch(/AIQT control root/);
    expect(text).toMatch(/do not rely on a parent Git repository/i);
    expect(text).toMatch(/do not commit implementation work unit changes to the aiqt control repository/i);
  });
});

describe("renderDriverSourceControlDisciplineSection: repository boundary preflight (F063)", () => {
  it("includes the repository boundary rule and branch expectation even with no roots given", () => {
    const text = renderDriverSourceControlDisciplineSection();
    expect(text).toContain("Repository Boundary Rule:");
    expect(text).toContain("git rev-parse --show-toplevel");
    expect(text).toContain("git branch --show-current");
    expect(text).toContain("git status --short");
    expect(text).toMatch(/branch should be main unless the user explicitly configured a different branch policy/i);
  });

  it("explicitly names the AIQT control root and implementation root when known", () => {
    const text = renderDriverSourceControlDisciplineSection({
      controlRoot: "/home/user/aiqt-control",
      implementationRoot: "/home/user/aiqt-control/app",
    });
    expect(text).toContain("AIQT control root: /home/user/aiqt-control");
    expect(text).toContain("Implementation root: /home/user/aiqt-control/app");
  });

  it("does not claim a control root as the implementation root when none is configured", () => {
    const text = renderDriverSourceControlDisciplineSection({ controlRoot: "/home/user/aiqt-control" });
    expect(text).toContain("AIQT control root: /home/user/aiqt-control");
    expect(text).toMatch(/not yet configured -- do not assume the control root is the implementation root/i);
  });
});

describe("renderSourceControlExpectationsSection: repository boundary rule (F063)", () => {
  it("includes the boundary rule and the toplevel comparison instruction", () => {
    const text = renderSourceControlExpectationsSection({ workUnitId: "WU001", milestoneId: "M001" });
    expect(text).toContain("## Source Control Expectations");
    expect(text).toContain("Repository Boundary Rule:");
    expect(text).toContain("git rev-parse --show-toplevel");
    expect(text).toMatch(/stop and correct the repository boundary/i);
  });
});

describe("renderCheckpointSourceControlGuidance: boundary report fields (F063)", () => {
  it("asks for Git top-level and boundary verified fields", () => {
    const text = renderCheckpointSourceControlGuidance();
    expect(text).toContain("Git top-level (git rev-parse --show-toplevel):");
    expect(text).toContain("Boundary verified: yes/no");
  });
});
