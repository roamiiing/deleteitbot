import type { DeleteItRepository } from "./repository";
import type { MatchResult } from "./filter";

export type TextFilter = {
  match(text: string): MatchResult | undefined;
};

export type TelegramApi = {
  deleteMessage(chatId: number, messageId: number): Promise<unknown>;
  getChatMember(chatId: number, userId: number): Promise<{ status: string }>;
};

type MessageContentInput = { chatId: number; messageId: number; text?: string; caption?: string };

export class DeleteItService {
  constructor(
    private readonly repo: DeleteItRepository,
    private readonly filter: TextFilter,
    private readonly options: { deleteDelaySeconds: number; maxAttempts?: number; now?: () => number },
  ) {}

  handleMessage(input: MessageContentInput) {
    const result = this.handleContent(input, { clearPendingWhenClean: false });
    if (!result?.matchedEntry) return undefined;
    return { react: "👾" as const, matchedEntry: result.matchedEntry };
  }

  handleEditedMessage(input: MessageContentInput) {
    const result = this.handleContent(input, { clearPendingWhenClean: true });
    if (!result) return undefined;
    if (result.matchedEntry) return { react: "👾" as const, matchedEntry: result.matchedEntry };
    return { clearReaction: true as const, cleared: result.cleared };
  }

  private handleContent(input: MessageContentInput, options: { clearPendingWhenClean: boolean }) {
    const content = input.text ?? input.caption;
    if (!content) return undefined;

    const match = this.filter.match(content);
    if (!match) {
      if (!options.clearPendingWhenClean) return undefined;
      return { cleared: this.repo.removePendingQueueRow({ chatId: input.chatId, messageId: input.messageId }) };
    }

    const now = this.now();
    this.repo.upsertQueue({
      chatId: input.chatId,
      messageId: input.messageId,
      matchedEntry: match.matchedEntry,
      detectedAt: now,
      deleteAfter: now + this.options.deleteDelaySeconds,
    });

    return { matchedEntry: match.matchedEntry };
  }

  async handleReaction(input: { chatId: number; messageId: number; userId?: number; hasDeleteItReaction: boolean }, api: TelegramApi) {
    if (!input.userId) return { ignored: "anonymous" as const };

    const member = await api.getChatMember(input.chatId, input.userId);
    if (member.status !== "creator" && member.status !== "administrator") return { ignored: "non-admin" as const };

    if (input.hasDeleteItReaction) {
      this.repo.addVeto({ chatId: input.chatId, messageId: input.messageId, adminUserId: input.userId, createdAt: this.now() });
      return { vetoed: true as const };
    }

    this.repo.removeVeto({ chatId: input.chatId, messageId: input.messageId, adminUserId: input.userId });
    return { vetoed: false as const };
  }

  async sweep(api: Pick<TelegramApi, "deleteMessage">, limit = 50) {
    const now = this.now();
    const rows = this.repo.findDue(now, limit);
    const results: Array<{ chatId: number; messageId: number; status: "deleted" | "failed" | "retry" }> = [];

    for (const row of rows) {
      try {
        await api.deleteMessage(row.chatId, row.messageId);
        this.repo.markDeleted(row, this.now());
        results.push({ chatId: row.chatId, messageId: row.messageId, status: "deleted" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const permanent = isPermanentDeleteFailure(message) || row.attempts + 1 >= (this.options.maxAttempts ?? 5);
        this.repo.markFailure(row, message, this.now(), permanent);
        results.push({ chatId: row.chatId, messageId: row.messageId, status: permanent ? "failed" : "retry" });
      }
    }

    return results;
  }

  async isAdmin(chatId: number, userId: number, api: Pick<TelegramApi, "getChatMember">) {
    const member = await api.getChatMember(chatId, userId);
    return member.status === "creator" || member.status === "administrator";
  }

  async forcePurgePending(
    chatId: number,
    api: Pick<TelegramApi, "deleteMessage">,
    options?: { limitPerBatch?: number },
  ): Promise<{ deleted: number; failed: number; retried: number }> {
    const limitPerBatch = options?.limitPerBatch ?? 50;
    const seen = new Set<string>();
    let deleted = 0;
    let failed = 0;
    let retried = 0;

    while (true) {
      const rows = this.repo.findPendingForChat(chatId, limitPerBatch);
      if (rows.length === 0) break;

      // Prevent infinite loops if transient failures remain `pending` and are re-selected.
      if (rows.every((row: { chatId: number; messageId: number }) => seen.has(queueKey(row)))) break;

      for (const row of rows) {
        const key = queueKey(row);
        if (seen.has(key)) continue;
        seen.add(key);

        try {
          await api.deleteMessage(row.chatId, row.messageId);
          this.repo.markDeleted(row, this.now());
          deleted += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const permanent = isPermanentDeleteFailure(message) || row.attempts + 1 >= (this.options.maxAttempts ?? 5);
          this.repo.markFailure(row, message, this.now(), permanent);
          if (permanent) failed += 1;
          else retried += 1;
        }
      }
    }

    return { deleted, failed, retried };
  }

  private now() {
    return Math.floor((this.options.now?.() ?? Date.now()) / 1000);
  }
}

export function isPermanentDeleteFailure(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("message to delete not found") ||
    normalized.includes("message can't be deleted") ||
    normalized.includes("message can not be deleted") ||
    normalized.includes("not enough rights")
  );
}

function queueKey(row: { chatId: number; messageId: number }) {
  return `${row.chatId}:${row.messageId}`;
}
