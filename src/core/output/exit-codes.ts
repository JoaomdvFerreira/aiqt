export const ExitCode = {
  Success: 0,
  ValidationFailed: 1,
  WorkflowBlocked: 2,
  InvalidInput: 3,
  MissingDependency: 4,
  ExternalIntegrationError: 5,
  HumanInputRequired: 10,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
