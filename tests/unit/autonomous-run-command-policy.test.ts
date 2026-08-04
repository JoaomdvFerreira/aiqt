import { describe, expect, it } from "vitest";
import type { AutonomousExecutionPolicy } from "../../src/schema/autonomous-run.schema.js";
import { classifyCommand, decideCommand } from "../../src/workflow/autonomous-run-command-policy.js";

describe("M36-WU01: command classification", () => {
  it.each([
    ["rm -rf /tmp/something", "destructive"],
    ["git push origin main --force", "destructive"],
    ["git push -f origin main", "destructive"],
    ["git reset --hard HEAD~1", "destructive"],
    ["git clean -fd", "destructive"],
    ["git branch -D old-branch", "destructive"],
  ] as const)("classifies %j as destructive", (cmd, expected) => {
    expect(classifyCommand(cmd)).toBe(expected);
  });

  it.each([
    ["sudo rm file", "privileged"],
    ["chmod 777 /etc/passwd", "privileged"],
    ["chown root file", "privileged"],
  ] as const)("classifies %j as privileged", (cmd, expected) => {
    expect(classifyCommand(cmd)).toBe(expected);
  });

  it.each([
    ["curl https://example.com", "network"],
    ["wget https://example.com/file", "network"],
    ["git clone https://example.com/repo.git", "network"],
    ["npm install left-pad", "network"],
  ] as const)("classifies %j as network", (cmd, expected) => {
    expect(classifyCommand(cmd)).toBe(expected);
  });

  it.each([
    ["pnpm test", "test_or_build"],
    ["pnpm build", "test_or_build"],
    ["npx vitest run", "test_or_build"],
    ["tsc --noEmit", "test_or_build"],
  ] as const)("classifies %j as test_or_build", (cmd, expected) => {
    expect(classifyCommand(cmd)).toBe(expected);
  });

  it.each([
    ["git status", "git_operation"],
    ["git diff", "git_operation"],
    ["git add README.md", "git_operation"],
    ["git commit -m 'fix'", "git_operation"],
  ] as const)("classifies %j as git_operation", (cmd, expected) => {
    expect(classifyCommand(cmd)).toBe(expected);
  });

  it.each([
    ["ls -la", "read_only_inspection"],
    ["cat package.json", "read_only_inspection"],
    ["grep -rn foo src/", "read_only_inspection"],
  ] as const)("classifies %j as read_only_inspection", (cmd, expected) => {
    expect(classifyCommand(cmd)).toBe(expected);
  });

  it("classifies an unrecognized command as privileged (fail-closed default)", () => {
    expect(classifyCommand("some-totally-unknown-binary --flag")).toBe("privileged");
  });

  it("classifies an empty command as privileged (fail-closed default)", () => {
    expect(classifyCommand("")).toBe("privileged");
    expect(classifyCommand("   ")).toBe("privileged");
  });

  it("a destructive-looking git push takes precedence over the generic git-operation pattern", () => {
    expect(classifyCommand("git push --force origin main")).toBe("destructive");
    expect(classifyCommand("git push origin main")).toBe("network");
  });
});

describe("M36-WU01: command-policy decisions", () => {
  const standardPolicy: AutonomousExecutionPolicy = {
    allowedCommandClasses: ["read_only_inspection", "repository_local_write", "git_operation", "test_or_build"],
    blockedCommandClasses: [],
    networkPolicy: "denied",
    filesystemBoundary: "/tmp/aiqt-run",
    gitBoundary: { allowedBaseRefPrefixes: ["refs/heads/"] },
  };

  it("allows a test command under the standard policy", () => {
    const decision = decideCommand("pnpm test", standardPolicy);
    expect(decision.allowed).toBe(true);
    expect(decision.commandClass).toBe("test_or_build");
  });

  it("allows a read-only git command under the standard policy", () => {
    const decision = decideCommand("git status", standardPolicy);
    expect(decision.allowed).toBe(true);
  });

  it("denies a destructive command even though the policy never explicitly blocked it", () => {
    const decision = decideCommand("rm -rf /", standardPolicy);
    expect(decision.allowed).toBe(false);
    expect(decision.commandClass).toBe("destructive");
  });

  it("denies a privileged command even though the policy never explicitly blocked it", () => {
    const decision = decideCommand("sudo apt-get install x", standardPolicy);
    expect(decision.allowed).toBe(false);
    expect(decision.commandClass).toBe("privileged");
  });

  it("denies network commands when networkPolicy is denied", () => {
    const decision = decideCommand("curl https://example.com", standardPolicy);
    expect(decision.allowed).toBe(false);
    expect(decision.commandClass).toBe("network");
  });

  it("allows network commands when networkPolicy is explicitly_enabled and the class is allowlisted", () => {
    const networkPolicy: AutonomousExecutionPolicy = {
      ...standardPolicy,
      allowedCommandClasses: [...standardPolicy.allowedCommandClasses, "network"],
      networkPolicy: "explicitly_enabled",
    };
    const decision = decideCommand("curl https://example.com", networkPolicy);
    expect(decision.allowed).toBe(true);
  });

  it("denies a command whose class the policy explicitly blocks even if generally allowed", () => {
    const restrictivePolicy: AutonomousExecutionPolicy = {
      ...standardPolicy,
      blockedCommandClasses: ["git_operation"],
    };
    const decision = decideCommand("git status", restrictivePolicy);
    expect(decision.allowed).toBe(false);
  });

  it("denies a command whose class the policy's allowedCommandClasses omits", () => {
    const narrowPolicy: AutonomousExecutionPolicy = {
      ...standardPolicy,
      allowedCommandClasses: ["read_only_inspection"],
    };
    const decision = decideCommand("pnpm test", narrowPolicy);
    expect(decision.allowed).toBe(false);
  });

  it("no policy configuration can allow a destructive or privileged command (no override path exists)", () => {
    const permissivePolicy: AutonomousExecutionPolicy = {
      allowedCommandClasses: [
        "read_only_inspection",
        "repository_local_write",
        "git_operation",
        "test_or_build",
        "network",
        "destructive",
        "privileged",
      ],
      blockedCommandClasses: [],
      networkPolicy: "explicitly_enabled",
      filesystemBoundary: "/tmp/aiqt-run",
      gitBoundary: { allowedBaseRefPrefixes: ["refs/heads/"] },
    };
    expect(decideCommand("rm -rf /", permissivePolicy).allowed).toBe(false);
    expect(decideCommand("sudo rm file", permissivePolicy).allowed).toBe(false);
  });
});
