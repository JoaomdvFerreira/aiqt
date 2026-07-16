import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { runInit } from "../src/cli/commands/init.command.js";
import { runUpdate } from "../src/cli/commands/update.command.js";
import { runPlan } from "../src/cli/commands/plan.command.js";
import { runNext } from "../src/cli/commands/next.command.js";
import { runCheckpoint } from "../src/cli/commands/checkpoint.command.js";
import { normalizeInitOptions } from "../src/cli/options.js";
import { ExitCode } from "../src/core/output/exit-codes.js";
import { contextFor } from "./helpers.js";

function wu(clientKey: string, milestoneClientKey: string, title: string) {
  return {
    clientKey,
    milestoneClientKey,
    title,
    objective: `${title}.`,
    scope: [`Implement ${title}.`],
    outOfScope: ["Nothing outside this unit's scope."],
    acceptanceCriteria: [`${title} is complete.`],
    agentContextRefs: [],
    suggestedFiles: ["src/"],
    validationCommands: ["pnpm test"],
  };
}

const CORTE0_MILESTONES = [
  { clientKey: "m1", title: "Contas", objective: "Account foundations." },
  { clientKey: "m2", title: "Transacoes", objective: "Transaction tracking." },
  { clientKey: "m3", title: "Categorias", objective: "Categorization." },
  { clientKey: "m4", title: "Relatorios", objective: "Reporting." },
  { clientKey: "m5", title: "Fecho", objective: "Corte 0 closeout." },
];

const ROADMAP_MILESTONES = [
  { clientKey: "m6", title: "Corte 1 Roadmap", objective: "Placeholder milestone for Corte 1." },
  { clientKey: "m7", title: "Corte 2 Roadmap", objective: "Placeholder milestone for Corte 2." },
  { clientKey: "m8", title: "Corte 3 Roadmap", objective: "Placeholder milestone for Corte 3." },
  { clientKey: "m9", title: "Corte 4 Roadmap", objective: "Placeholder milestone for Corte 4." },
  { clientKey: "m10", title: "Corte 5 Roadmap", objective: "Placeholder milestone for Corte 5." },
  { clientKey: "m11", title: "Corte 6 Roadmap", objective: "Placeholder milestone for Corte 6." },
  { clientKey: "m12", title: "Corte 7 Roadmap", objective: "Placeholder milestone for Corte 7." },
];

const CORTE0_WORK_UNITS = [
  wu("wu1", "m1", "Create account model"),
  wu("wu2", "m1", "Create account CRUD"),
  wu("wu3", "m1", "Account validation"),
  wu("wu4", "m2", "Create transaction model"),
  wu("wu5", "m2", "Transaction CRUD"),
  wu("wu6", "m2", "Transaction validation"),
  wu("wu7", "m3", "Category model"),
  wu("wu8", "m3", "Category CRUD"),
  wu("wu9", "m3", "Category assignment"),
  wu("wu10", "m4", "Monthly report"),
  wu("wu11", "m4", "Category report"),
  wu("wu12", "m4", "Export report"),
  wu("wu13", "m5", "Final QA pass"),
  wu("wu14", "m5", "Corte 0 closeout"),
];

const ROADMAP_WORK_UNITS = [
  wu("wu15", "m6", "Corte 1 roadmap placeholder"),
  wu("wu16", "m7", "Corte 2 roadmap placeholder"),
  wu("wu17", "m8", "Corte 3 roadmap placeholder"),
  wu("wu18", "m9", "Corte 4 roadmap placeholder"),
  wu("wu19", "m10", "Corte 5 roadmap placeholder"),
  wu("wu20", "m11", "Corte 6 roadmap placeholder"),
  wu("wu21", "m12", "Corte 7 roadmap placeholder"),
];

const PLAN_INPUT = {
  milestones: [...CORTE0_MILESTONES, ...ROADMAP_MILESTONES],
  workUnits: [...CORTE0_WORK_UNITS, ...ROADMAP_WORK_UNITS],
  dependencies: [
    { fromClientKey: "wu14", toClientKey: "wu15", type: "blocks" },
    { fromClientKey: "wu15", toClientKey: "wu16", type: "blocks" },
  ],
};

const DONE_PAYLOAD = {
  summary: "Implemented the bounded unit.",
  completed: ["Implemented the unit."],
  notCompleted: [],
  filesChanged: ["src/example.ts"],
  validationResult: "passed",
  acceptanceCriteriaResult: "passed",
  validationCommands: [{ command: "pnpm test", result: "passed" }],
  acceptanceCriteria: [{ criterion: "Works", result: "passed" }],
  issues: [],
  notes: [],
};

/**
 * M17 §19.4: the observed financas-pessoais dogfood regression state after
 * Corte 0 -- 12 milestones, 21 work units, WU001-WU014 done, WU015 ready as
 * the Corte 1 roadmap placeholder (promoted to ready by its real incoming
 * `blocks` dependency from WU014 being satisfied), WU016 planned/blocked
 * behind WU015's outgoing `blocks` dependency, and WU017-WU021 further
 * roadmap placeholders.
 */
export async function buildFinancasCorte0Fixture(dir: string): Promise<void> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), {
    objective: "Build a personal finance tracker (financas-pessoais).",
    targetUser: ["individual users"],
  });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });

  const planPath = join(dir, "financas-plan.json");
  writeFileSync(planPath, JSON.stringify(PLAN_INPUT));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);

  for (let i = 0; i < 14; i++) {
    const nextResult = runNext(contextFor(dir));
    expect(nextResult.exitCode).toBe(ExitCode.Success);
    const cpResult = runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD });
    expect(cpResult.exitCode).toBe(ExitCode.Success);
  }
}

/** A bounded, valid Corte 1 extension payload replacing WU015. */
export const FINANCAS_CORTE1_EXTENSION = {
  extension: {
    entryWorkUnitClientKeys: ["c1-wu01"],
    exitWorkUnitClientKeys: ["c1-wu03"],
    reason: "Expand the Corte 1 roadmap placeholder after Corte 0 completion.",
  },
  milestones: [
    { clientKey: "c1-m1", title: "Corte 1: Budgets", objective: "Add budgeting to the finance tracker." },
  ],
  workUnits: [
    wu("c1-wu01", "c1-m1", "Budget model"),
    wu("c1-wu02", "c1-m1", "Budget CRUD"),
    wu("c1-wu03", "c1-m1", "Budget report"),
  ],
  dependencies: [
    { fromClientKey: "c1-wu01", toClientKey: "c1-wu02", type: "blocks" },
    { fromClientKey: "c1-wu02", toClientKey: "c1-wu03", type: "blocks" },
  ],
};
