import { z } from "zod";

export const LORA_QUEUE_NAME = "buttercupp-lora";

export const expressionSchema = z.enum([
  "neutral", "smiling", "happy", "sad", "seductive", "laughing", "surprised",
]);
export type Expression = z.infer<typeof expressionSchema>;

export const poseSchema = z.enum([
  "front", "three_quarter_left", "three_quarter_right", "profile",
  "over_shoulder", "sitting", "lying", "arms_up",
]);
export type Pose = z.infer<typeof poseSchema>;

export const LORA_STATUSES = [
  "pending", "building", "training", "validating", "ready", "rejected", "failed",
] as const;
export type LoraStatus = (typeof LORA_STATUSES)[number];

// Enqueued by the admin train action; validated by the train-lora worker handler.
export const trainLoraJobPayloadSchema = z.object({
  source: z.literal("train-lora"),
  characterId: z.string().min(1).max(64),
  characterVersionId: z.string().min(1).max(64),
  requestedBy: z.string().min(1).max(128),
  targetImageCount: z.number().int().min(15).max(80).default(30),
  baseModel: z.enum(["realvisxl_v5", "juggernaut_xl_v9"]).default("realvisxl_v5"),
});
export type TrainLoraJobPayload = z.infer<typeof trainLoraJobPayloadSchema>;
