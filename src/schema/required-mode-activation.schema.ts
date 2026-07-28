import { z } from "zod";

export const REQUIRED_MODE_ACTIVATION_PROTOCOL_VERSION = "aiqt-required-mode-activation@1" as const;

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const RequiredModeActivationSchema = z
  .object({
    protocolVersion: z.literal(REQUIRED_MODE_ACTIVATION_PROTOCOL_VERSION),
    activationId: z.string().min(1),
    planId: z.string().min(1),
    profileRef: z.object({ profileId: z.string().min(1), version: z.number().int().positive() }).strict(),
    activationSnapshotDigest: Sha256Schema,
    activatedAt: z.string(),
    activatedBy: z.string().min(1).max(200),
    reason: z.string().min(1).max(2000),
    grandfatheredWorkUnitIds: z.array(z.string().min(1)).max(10000),
    status: z.enum(["active", "deactivated"]),
    deactivatedAt: z.string().optional(),
    deactivatedBy: z.string().min(1).max(200).optional(),
    deactivationReason: z.string().max(2000).optional(),
  })
  .strict();
export type RequiredModeActivation = z.infer<typeof RequiredModeActivationSchema>;
