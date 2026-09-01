import { Schema, model, models, type InferSchemaType } from "mongoose";
import { connectMongo } from "@/lib/mongo";

const activityLogSchema = new Schema(
  {
    type: { type: String, required: true },
    message: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, required: false },
  },
  { timestamps: true },
);

export type ActivityLogDoc = InferSchemaType<typeof activityLogSchema>;

export const ActivityLog =
  models.ActivityLog ?? model("ActivityLog", activityLogSchema);

/** Records a platform event for the Admin Panel's activity feed. */
export async function logActivity(
  type: string,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await connectMongo();
  await ActivityLog.create({ type, message, metadata });
}
