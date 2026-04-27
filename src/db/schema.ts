import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const deletionQueue = sqliteTable(
  "deletion_queue",
  {
    chatId: integer("chat_id", { mode: "number" }).notNull(),
    messageId: integer("message_id", { mode: "number" }).notNull(),
    detectedAt: integer("detected_at", { mode: "number" }).notNull(),
    deleteAfter: integer("delete_after", { mode: "number" }).notNull(),
    matchedWord: text("matched_word").notNull(),
    status: text("status", { enum: ["pending", "deleted", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts", { mode: "number" }).notNull().default(0),
    lastError: text("last_error"),
    deletedAt: integer("deleted_at", { mode: "number" }),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => ({
    messageUnique: uniqueIndex("deletion_queue_message_unique").on(table.chatId, table.messageId),
    dueIdx: index("deletion_queue_due_idx").on(table.status, table.deleteAfter),
  }),
);

export const adminVetoes = sqliteTable(
  "admin_vetoes",
  {
    chatId: integer("chat_id", { mode: "number" }).notNull(),
    messageId: integer("message_id", { mode: "number" }).notNull(),
    adminUserId: integer("admin_user_id", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => ({
    vetoUnique: uniqueIndex("admin_vetoes_message_admin_unique").on(table.chatId, table.messageId, table.adminUserId),
    messageIdx: index("admin_vetoes_message_idx").on(table.chatId, table.messageId),
  }),
);

export type QueueRow = typeof deletionQueue.$inferSelect;
export type NewQueueRow = typeof deletionQueue.$inferInsert;
export type AdminVeto = typeof adminVetoes.$inferSelect;
