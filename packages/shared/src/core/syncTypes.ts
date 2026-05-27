import { z } from "zod";
import { ProjectRecordSchema } from "./schemas";

export const SyncDocumentSchema = z.object({
  scope: z.enum(["profile", "project"]),
  projectSlug: z.string().optional(),
  contentSha256: z.string(),
  title: z.string(),
  sourceType: z.string(),
  pinnedByDefault: z.boolean(),
  note: z.string().optional(),
  createdAt: z.string(),
  contentBase64: z.string()
}).strict();
export type SyncDocument = z.infer<typeof SyncDocumentSchema>;

export const SyncProjectSchema = z.object({
  slug: z.string(),
  record: ProjectRecordSchema,
  updatedAt: z.string()
}).strict();
export type SyncProject = z.infer<typeof SyncProjectSchema>;

export const SyncSetSchema = z.object({
  documents: z.array(SyncDocumentSchema).readonly(),
  projects: z.array(SyncProjectSchema).readonly()
}).strict();
export type SyncSet = z.infer<typeof SyncSetSchema>;
