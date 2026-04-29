import { and, eq, lte, ne, notExists, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { adminVetoes, deletionQueue, type QueueRow } from "./db/schema";

export class DeleteItRepository {
  constructor(private readonly db: Db) {}

  upsertQueue(input: { chatId: number; messageId: number; matchedEntry: string; detectedAt: number; deleteAfter: number }) {
    this.db
      .insert(deletionQueue)
      .values({
        chatId: input.chatId,
        messageId: input.messageId,
        matchedWord: input.matchedEntry,
        detectedAt: input.detectedAt,
        deleteAfter: input.deleteAfter,
        updatedAt: input.detectedAt,
      })
      .onConflictDoUpdate({
        target: [deletionQueue.chatId, deletionQueue.messageId],
        set: {
          matchedWord: input.matchedEntry,
          updatedAt: input.detectedAt,
          lastError: null,
        },
      })
      .run();
  }

  getQueueRow(chatId: number, messageId: number) {
    return this.db
      .select()
      .from(deletionQueue)
      .where(and(eq(deletionQueue.chatId, chatId), eq(deletionQueue.messageId, messageId)))
      .get();
  }

  removePendingQueueRow(input: { chatId: number; messageId: number }) {
    const row = this.db
      .select({ status: deletionQueue.status })
      .from(deletionQueue)
      .where(
        and(
          eq(deletionQueue.chatId, input.chatId),
          eq(deletionQueue.messageId, input.messageId),
          eq(deletionQueue.status, "pending"),
        ),
      )
      .get();

    if (!row) return false;

    this.db
      .delete(adminVetoes)
      .where(and(eq(adminVetoes.chatId, input.chatId), eq(adminVetoes.messageId, input.messageId)))
      .run();
    this.db
      .delete(deletionQueue)
      .where(
        and(
          eq(deletionQueue.chatId, input.chatId),
          eq(deletionQueue.messageId, input.messageId),
          eq(deletionQueue.status, "pending"),
        ),
      )
      .run();

    return true;
  }

  addVeto(input: { chatId: number; messageId: number; adminUserId: number; createdAt: number }) {
    this.db
      .insert(adminVetoes)
      .values(input)
      .onConflictDoNothing({ target: [adminVetoes.chatId, adminVetoes.messageId, adminVetoes.adminUserId] })
      .run();
  }

  removeVeto(input: { chatId: number; messageId: number; adminUserId: number }) {
    this.db
      .delete(adminVetoes)
      .where(
        and(
          eq(adminVetoes.chatId, input.chatId),
          eq(adminVetoes.messageId, input.messageId),
          eq(adminVetoes.adminUserId, input.adminUserId),
        ),
      )
      .run();
  }

  countVetoes(chatId: number, messageId: number) {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(adminVetoes)
      .where(and(eq(adminVetoes.chatId, chatId), eq(adminVetoes.messageId, messageId)))
      .get();
    return Number(row?.count ?? 0);
  }

  findDue(now: number, limit = 50) {
    return this.db
      .select()
      .from(deletionQueue)
      .where(
        and(
          eq(deletionQueue.status, "pending"),
          lte(deletionQueue.deleteAfter, now),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(adminVetoes)
              .where(and(eq(adminVetoes.chatId, deletionQueue.chatId), eq(adminVetoes.messageId, deletionQueue.messageId))),
          ),
        ),
      )
      .limit(limit)
      .all();
  }

  findPendingForChat(chatId: number, limit = 50, options?: { excludeMatchedWord?: string }) {
    const conditions = [
      eq(deletionQueue.chatId, chatId),
      eq(deletionQueue.status, "pending"),
      notExists(
        this.db
          .select({ one: sql`1` })
          .from(adminVetoes)
          .where(and(eq(adminVetoes.chatId, deletionQueue.chatId), eq(adminVetoes.messageId, deletionQueue.messageId))),
      ),
    ];
    if (options?.excludeMatchedWord) conditions.push(ne(deletionQueue.matchedWord, options.excludeMatchedWord));

    return this.db
      .select()
      .from(deletionQueue)
      .where(and(...conditions))
      .limit(limit)
      .all();
  }

  markDeleted(row: Pick<QueueRow, "chatId" | "messageId">, now: number) {
    this.db
      .update(deletionQueue)
      .set({ status: "deleted", deletedAt: now, updatedAt: now, lastError: null })
      .where(and(eq(deletionQueue.chatId, row.chatId), eq(deletionQueue.messageId, row.messageId)))
      .run();
  }

  markFailure(row: Pick<QueueRow, "chatId" | "messageId" | "attempts">, error: string, now: number, permanent: boolean) {
    this.db
      .update(deletionQueue)
      .set({
        status: permanent ? "failed" : "pending",
        attempts: row.attempts + 1,
        lastError: error,
        updatedAt: now,
      })
      .where(and(eq(deletionQueue.chatId, row.chatId), eq(deletionQueue.messageId, row.messageId)))
      .run();
  }
}
