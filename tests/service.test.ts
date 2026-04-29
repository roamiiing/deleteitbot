import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALLOWED_UPDATES, formatForcePurgeStarted, formatWhyResult, hasEmojiReaction } from "../src/bot";
import { createDb } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { createFilter } from "../src/filter";
import { DeleteItRepository } from "../src/repository";
import { BOT_MESSAGE_MATCH, DELETE_REACTION, DeleteItService, MANUAL_REACTION_MATCH, VETO_REACTION, type TelegramApi } from "../src/service";

let dir: string;
let repo: DeleteItRepository;
let service: DeleteItService;
let nowMs: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deleteitbot-"));
  const url = `file:${join(dir, "test.sqlite")}`;
  migrate(url);
  repo = new DeleteItRepository(createDb(url).db);
  nowMs = 1_700_000_000_000;
  service = new DeleteItService(repo, createFilter(["bad"]), { deleteDelaySeconds: 60, now: () => nowMs });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function api(status = "administrator", fail?: Error): TelegramApi & { deleted: Array<[number, number]> } {
  return {
    deleted: [],
    async getChatMember() {
      return { status };
    },
    async deleteMessage(chatId: number, messageId: number) {
      if (fail) throw fail;
      this.deleted.push([chatId, messageId]);
    },
  };
}

function queue(messageId: number, text = "bad", chatId = 100) {
  const action = service.handleMessage({ chatId, messageId, text });
  expect(action).toEqual({ reactions: [DELETE_REACTION], matchedEntry: "bad" });
}

test("banned message queues deletion and reacts", () => {
  const action = service.handleMessage({ chatId: 100, messageId: 10, text: "this is bad" });

  expect(action).toEqual({ reactions: [DELETE_REACTION], matchedEntry: "bad" });
  const row = repo.getQueueRow(100, 10)!;
  expect(row.deleteAfter).toBe(1_700_000_060);
  expect(row.matchedWord).toBe("bad");
  expect(row.status).toBe("pending");
});

test("caption is queued the same way as text", () => {
  const action = service.handleMessage({ chatId: 100, messageId: 10, caption: "photo caption with bad word" });

  expect(action).toEqual({ reactions: [DELETE_REACTION], matchedEntry: "bad" });
  expect(repo.getQueueRow(100, 10)!.deleteAfter).toBe(1_700_000_060);
});

test("queue stores the exact dictionary entry that triggered the ban, not the matched spelling", () => {
  const entryService = new DeleteItService(repo, createFilter(["роскомнадзор"]), { deleteDelaySeconds: 60, now: () => nowMs });

  const action = entryService.handleMessage({ chatId: 100, messageId: 10, text: "тут Р0СК0МНАДЗ0Р" });

  expect(action).toEqual({ reactions: [DELETE_REACTION], matchedEntry: "роскомнадзор" });
  expect(repo.getQueueRow(100, 10)!.matchedWord).toBe("роскомнадзор");
});

test("clean message does not create a queue row or reaction", () => {
  expect(service.handleMessage({ chatId: 100, messageId: 10, text: "clean message" })).toBeUndefined();
  expect(repo.getQueueRow(100, 10)).toBeUndefined();
});

test("edited banned message queues deletion and requests a reaction", () => {
  const action = service.handleEditedMessage({ chatId: 100, messageId: 10, text: "edited into bad content" });

  expect(action).toEqual({ reactions: [DELETE_REACTION], matchedEntry: "bad" });
  const row = repo.getQueueRow(100, 10)!;
  expect(row.deleteAfter).toBe(1_700_000_060);
  expect(row.matchedWord).toBe("bad");
  expect(row.status).toBe("pending");
});

test("clean edit removes pending deletion and prevents later sweep", async () => {
  queue(10);

  expect(service.handleEditedMessage({ chatId: 100, messageId: 10, text: "clean now" })).toEqual({ clearReaction: true, cleared: true });
  expect(repo.getQueueRow(100, 10)).toBeUndefined();

  nowMs += 60_000;
  const telegram = api();
  expect(await service.sweep(telegram)).toEqual([]);
  expect(telegram.deleted).toEqual([]);
});

test("clean edit removes stale admin veto before a later banned edit", async () => {
  queue(10);
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: true }, api());
  expect(repo.countVetoes(100, 10)).toBe(1);

  expect(service.handleEditedMessage({ chatId: 100, messageId: 10, text: "clean now" })).toEqual({ clearReaction: true, cleared: true });
  expect(repo.getQueueRow(100, 10)).toBeUndefined();
  expect(repo.countVetoes(100, 10)).toBe(0);

  service.handleEditedMessage({ chatId: 100, messageId: 10, text: "bad again" });
  nowMs += 60_000;
  const telegram = api();
  expect(await service.sweep(telegram)).toEqual([{ chatId: 100, messageId: 10, status: "deleted" }]);
  expect(telegram.deleted).toEqual([[100, 10]]);
});

test("queue upsert is idempotent and keeps original deletion deadline", () => {
  service.handleMessage({ chatId: 100, messageId: 10, text: "bad" });
  nowMs += 30_000;
  service.handleMessage({ chatId: 100, messageId: 10, text: "bad again" });

  const row = repo.getQueueRow(100, 10)!;
  expect(row.detectedAt).toBe(1_700_000_000);
  expect(row.deleteAfter).toBe(1_700_000_060);
});

test("sweep does not delete before delete_after", async () => {
  queue(10);
  nowMs += 59_000;
  const telegram = api();

  expect(await service.sweep(telegram)).toEqual([]);
  expect(telegram.deleted).toEqual([]);
  expect(repo.getQueueRow(100, 10)!.status).toBe("pending");
});

test("sweep deletes a due message and does not retry deleted rows", async () => {
  queue(10);
  nowMs += 60_000;
  const telegram = api();

  expect(await service.sweep(telegram)).toEqual([{ chatId: 100, messageId: 10, status: "deleted" }]);
  expect(await service.sweep(telegram)).toEqual([]);
  expect(telegram.deleted).toEqual([[100, 10]]);
  expect(repo.getQueueRow(100, 10)!.deletedAt).toBe(1_700_000_060);
});

test("sweep respects batch limit", async () => {
  queue(10);
  queue(11);
  queue(12);
  nowMs += 60_000;
  const telegram = api();

  const result = await service.sweep(telegram, 2);

  expect(result).toHaveLength(2);
  expect(telegram.deleted).toHaveLength(2);
  expect(repo.getQueueRow(100, 12)!.status).toBe("pending");
});

test("force purge deletes pending messages before delete_after", async () => {
  queue(10);
  const telegram = api();

  expect(await service.forcePurgePending(100, telegram)).toEqual({ deleted: 1, failed: 0, retried: 0 });
  expect(telegram.deleted).toEqual([[100, 10]]);
  expect(repo.getQueueRow(100, 10)!.status).toBe("deleted");
});

test("force purge deletes queued bot explanation messages", async () => {
  queue(10);
  service.queueBotMessageForDeletion({ chatId: 100, messageId: 99 });
  const telegram = api();

  expect(repo.getQueueRow(100, 99)!.matchedWord).toBe(BOT_MESSAGE_MATCH);
  expect(await service.forcePurgePending(100, telegram)).toEqual({ deleted: 2, failed: 0, retried: 0 });
  expect(telegram.deleted).toEqual([
    [100, 10],
    [100, 99],
  ]);
  expect(repo.getQueueRow(100, 99)!.status).toBe("deleted");
});

test("force purge only deletes pending messages from the requested chat", async () => {
  queue(10, "bad", 100);
  queue(20, "bad", 200);
  const telegram = api();

  expect(await service.forcePurgePending(100, telegram)).toEqual({ deleted: 1, failed: 0, retried: 0 });
  expect(telegram.deleted).toEqual([[100, 10]]);
  expect(repo.getQueueRow(100, 10)!.status).toBe("deleted");
  expect(repo.getQueueRow(200, 20)!.status).toBe("pending");
});

test("force purge respects admin vetoes", async () => {
  queue(10);
  queue(11);
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: true }, api());
  const telegram = api();

  expect(await service.forcePurgePending(100, telegram)).toEqual({ deleted: 1, failed: 0, retried: 0 });
  expect(telegram.deleted).toEqual([[100, 11]]);
  expect(repo.getQueueRow(100, 10)!.status).toBe("pending");
  expect(repo.getQueueRow(100, 11)!.status).toBe("deleted");
});

test("force purge continues across batches until no eligible pending rows remain", async () => {
  queue(10);
  queue(11);
  queue(12);
  const telegram = api();

  expect(await service.forcePurgePending(100, telegram, { limitPerBatch: 2 })).toEqual({ deleted: 3, failed: 0, retried: 0 });
  expect(telegram.deleted).toEqual([
    [100, 10],
    [100, 11],
    [100, 12],
  ]);
});

test("force purge records permanent failures", async () => {
  queue(10);
  const telegram = api("administrator", new Error("Bad Request: message to delete not found"));

  expect(await service.forcePurgePending(100, telegram)).toEqual({ deleted: 0, failed: 1, retried: 0 });
  expect(repo.getQueueRow(100, 10)!.status).toBe("failed");
});

test("due messages are skipped while an admin veto exists", async () => {
  service.handleMessage({ chatId: 100, messageId: 10, text: "bad" });
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: true }, api());
  nowMs += 61_000;
  const telegram = api();

  expect(await service.sweep(telegram)).toEqual([]);
  expect(telegram.deleted).toEqual([]);
});

test("deleting becomes eligible again after veto removal", async () => {
  service.handleMessage({ chatId: 100, messageId: 10, text: "bad" });
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: true }, api());
  nowMs += 61_000;
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hadVetoReaction: true, hasVetoReaction: false }, api());
  const telegram = api();

  expect(await service.sweep(telegram)).toEqual([{ chatId: 100, messageId: 10, status: "deleted" }]);
  expect(telegram.deleted).toEqual([[100, 10]]);
  expect(repo.getQueueRow(100, 10)!.status).toBe("deleted");
});

test("multiple admin vetoes keep deletion paused until all are removed", async () => {
  service.handleMessage({ chatId: 100, messageId: 10, text: "bad" });
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: true }, api());
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 2, hasVetoReaction: true }, api());
  nowMs += 61_000;
  expect(
    await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hadVetoReaction: true, hasVetoReaction: false }, api()),
  ).toEqual({ vetoed: false });

  expect(await service.sweep(api())).toEqual([]);
  expect(
    await service.handleReaction({ chatId: 100, messageId: 10, userId: 2, hadVetoReaction: true, hasVetoReaction: false }, api()),
  ).toEqual({ vetoed: false, reactions: [DELETE_REACTION] });
  expect(await service.sweep(api())).toEqual([{ chatId: 100, messageId: 10, status: "deleted" }]);
});

test("non-admin reaction does not affect deletion", async () => {
  service.handleMessage({ chatId: 100, messageId: 10, text: "bad" });
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: true }, api("member"));
  nowMs += 61_000;
  const telegram = api();

  expect(await service.sweep(telegram)).toEqual([{ chatId: 100, messageId: 10, status: "deleted" }]);
});

test("admin veto reaction creates and removes veto", async () => {
  queue(10);

  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: true }, api())).toEqual({
    vetoed: true,
    reactions: [VETO_REACTION],
  });
  expect(repo.countVetoes(100, 10)).toBe(1);
  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hadVetoReaction: true, hasVetoReaction: false }, api())).toEqual({
    vetoed: false,
    reactions: [DELETE_REACTION],
  });
  expect(repo.countVetoes(100, 10)).toBe(0);
});

test("admin veto reaction on an unsuspected message is ignored", async () => {
  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: true }, api())).toEqual({
    ignored: "not-queued",
  });
  expect(repo.countVetoes(100, 10)).toBe(0);
});

test("other admin reaction does not remove active veto", async () => {
  queue(10);
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: true }, api());

  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 2 }, api())).toEqual({
    ignored: "no-reaction-change",
  });
  expect(repo.countVetoes(100, 10)).toBe(1);
});

test("admin delete reaction manually queues deletion and bot reactions", async () => {
  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteReaction: true }, api())).toEqual({
    flagged: true,
    reactions: [DELETE_REACTION],
  });

  const row = repo.getQueueRow(100, 10)!;
  expect(row.deleteAfter).toBe(1_700_000_060);
  expect(row.matchedWord).toBe(MANUAL_REACTION_MATCH);
  expect(row.status).toBe("pending");
});

test("admin delete reaction does not override active veto", async () => {
  queue(10);
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: true }, api());

  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 2, hasDeleteReaction: true }, api())).toEqual({
    flagged: true,
  });
  expect(repo.countVetoes(100, 10)).toBe(1);
});

test("removing manual delete reaction clears pending queue and bot reaction", async () => {
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteReaction: true }, api());

  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hadDeleteReaction: true }, api())).toEqual({
    unflagged: true,
    clearReaction: true,
    cleared: true,
  });
  expect(repo.getQueueRow(100, 10)).toBeUndefined();
});

test("removing manual delete reaction while veto remains clears queue and vetoes", async () => {
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteReaction: true }, api());
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteReaction: true, hasVetoReaction: true }, api());

  expect(repo.countVetoes(100, 10)).toBe(1);
  expect(
    await service.handleReaction(
      { chatId: 100, messageId: 10, userId: 1, hadDeleteReaction: true, hadVetoReaction: true, hasVetoReaction: true },
      api(),
    ),
  ).toEqual({
    unflagged: true,
    clearReaction: true,
    cleared: true,
  });
  expect(repo.getQueueRow(100, 10)).toBeUndefined();
  expect(repo.countVetoes(100, 10)).toBe(0);

  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hadVetoReaction: true }, api())).toEqual({
    vetoed: false,
  });
});

test("removing veto while manual delete reaction remains restores bot delete reaction", async () => {
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteReaction: true }, api());
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteReaction: true, hasVetoReaction: true }, api());

  expect(
    await service.handleReaction(
      { chatId: 100, messageId: 10, userId: 1, hadDeleteReaction: true, hadVetoReaction: true, hasDeleteReaction: true },
      api(),
    ),
  ).toEqual({
    flagged: true,
    reactions: [DELETE_REACTION],
  });
  expect(repo.countVetoes(100, 10)).toBe(0);
  expect(repo.getQueueRow(100, 10)!.matchedWord).toBe(MANUAL_REACTION_MATCH);
});

test("removing delete reaction does not clear a filter queued message", async () => {
  queue(10);

  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hadDeleteReaction: true }, api())).toEqual({
    vetoed: false,
    reactions: [DELETE_REACTION],
  });
  expect(repo.getQueueRow(100, 10)!.status).toBe("pending");
});

test("delete reaction is not treated as veto", async () => {
  const reactions = [{ type: "emoji", emoji: DELETE_REACTION }];

  expect(hasEmojiReaction(reactions, VETO_REACTION)).toBe(false);
  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: false }, api())).toEqual({
    ignored: "no-reaction-change",
  });
  expect(repo.countVetoes(100, 10)).toBe(0);
});

test("removing delete reaction does not request bot reaction changes", async () => {
  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 1 }, api())).toEqual({ ignored: "no-reaction-change" });
});

test("anonymous reaction is ignored and does not call getChatMember", async () => {
  let getChatMemberCalls = 0;
  const telegram: TelegramApi = {
    async getChatMember() {
      getChatMemberCalls += 1;
      return { status: "administrator" };
    },
    async deleteMessage() {},
  };

  expect(await service.handleReaction({ chatId: 100, messageId: 10, hasVetoReaction: true }, telegram)).toEqual({ ignored: "anonymous" });
  expect(getChatMemberCalls).toBe(0);
  expect(repo.countVetoes(100, 10)).toBe(0);
});

test("bot reaction is ignored and does not call getChatMember", async () => {
  let getChatMemberCalls = 0;
  const telegram: TelegramApi = {
    async getChatMember() {
      getChatMemberCalls += 1;
      return { status: "administrator" };
    },
    async deleteMessage() {},
  };

  expect(
    await service.handleReaction({ chatId: 100, messageId: 10, userId: 999, userIsBot: true, hasVetoReaction: true }, telegram),
  ).toEqual({ ignored: "bot" });
  expect(getChatMemberCalls).toBe(0);
  expect(repo.countVetoes(100, 10)).toBe(0);
});

test("admin veto is idempotent for repeated reaction updates", async () => {
  queue(10);

  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasVetoReaction: true }, api());
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hadVetoReaction: true, hasVetoReaction: true }, api());

  expect(repo.countVetoes(100, 10)).toBe(1);
});

test("bot allowed updates include edited messages", () => {
  expect(ALLOWED_UPDATES).toContain("edited_message");
});

test("/force progress message is explicit before purge completes", () => {
  expect(formatForcePurgeStarted()).toBe("Начал принудительное удаление. Результат появится здесь.");
});

test("/why formats queued trigger reason", () => {
  expect(
    formatWhyResult({
      row: { matchedWord: "bad", status: "pending", lastError: null },
      liveMatch: { matchedEntry: "bad", matchedText: "b4d" },
      hasContent: true,
    }),
  ).toBe("Запретка: bad\nСтатус: ожидает удаления\nНайдено в тексте: b4d");
});

test("/why does not duplicate identical trigger and matched fragment", () => {
  expect(
    formatWhyResult({
      row: { matchedWord: "арта", status: "pending", lastError: null },
      liveMatch: { matchedEntry: "арта", matchedText: "арта" },
      hasContent: true,
    }),
  ).toBe("Запретка: арта\nСтатус: ожидает удаления");
});

test("/why formats vetoed pending messages as paused", () => {
  expect(
    formatWhyResult({
      row: { matchedWord: "bad", status: "pending", lastError: null },
      vetoCount: 1,
      liveMatch: { matchedEntry: "bad", matchedText: "bad" },
      hasContent: true,
    }),
  ).toBe("Запретка: bad\nСтатус: остановлено админской 🕊 (1)");
});

test("/why formats manual admin trigger reason", () => {
  expect(
    formatWhyResult({
      row: { matchedWord: MANUAL_REACTION_MATCH, status: "pending", lastError: null },
      hasContent: false,
    }),
  ).toBe("Запретка: ручная отметка админом 👾\nСтатус: ожидает удаления");
});

test("/why formats live trigger without a queue row", () => {
  expect(
    formatWhyResult({
      liveMatch: { matchedEntry: "bad", matchedText: "bad" },
      hasContent: true,
    }),
  ).toBe("Сейчас подходит под запретку: bad");
});

test("/why explains when no trigger reason is found", () => {
  expect(formatWhyResult({ hasContent: true })).toBe(
    "Не нашёл причину: сообщения нет в очереди, текущий текст не срабатывает на фильтр.",
  );
  expect(formatWhyResult({ hasContent: false })).toBe(
    "Не нашёл причину в очереди, а Telegram не передал текст или подпись сообщения для повторной проверки.",
  );
});

test("transient delete failure increments attempts and remains retryable", async () => {
  queue(10);
  nowMs += 60_000;

  expect(await service.sweep(api("administrator", new Error("Too Many Requests")))).toEqual([{ chatId: 100, messageId: 10, status: "retry" }]);
  const row = repo.getQueueRow(100, 10)!;
  expect(row.status).toBe("pending");
  expect(row.attempts).toBe(1);
  expect(row.lastError).toBe("Too Many Requests");
});

test("transient failure is retried on the next sweep and can succeed", async () => {
  queue(10);
  nowMs += 60_000;
  await service.sweep(api("administrator", new Error("Too Many Requests")));
  const telegram = api();

  expect(await service.sweep(telegram)).toEqual([{ chatId: 100, messageId: 10, status: "deleted" }]);
  const row = repo.getQueueRow(100, 10)!;
  expect(row.status).toBe("deleted");
  expect(row.lastError).toBeNull();
});

test("permanent delete failure marks row failed and is not retried", async () => {
  queue(10);
  nowMs += 60_000;
  const failingTelegram = api("administrator", new Error("Bad Request: message to delete not found"));

  expect(await service.sweep(failingTelegram)).toEqual([{ chatId: 100, messageId: 10, status: "failed" }]);
  expect(repo.getQueueRow(100, 10)!.status).toBe("failed");

  const telegram = api();
  expect(await service.sweep(telegram)).toEqual([]);
  expect(telegram.deleted).toEqual([]);
});

test("repeated transient failures eventually mark row failed", async () => {
  const limitedService = new DeleteItService(repo, createFilter(["bad"]), { deleteDelaySeconds: 60, maxAttempts: 2, now: () => nowMs });
  limitedService.handleMessage({ chatId: 100, messageId: 10, text: "bad" });
  nowMs += 60_000;

  expect(await limitedService.sweep(api("administrator", new Error("network timeout")))).toEqual([{ chatId: 100, messageId: 10, status: "retry" }]);
  expect(await limitedService.sweep(api("administrator", new Error("network timeout")))).toEqual([{ chatId: 100, messageId: 10, status: "failed" }]);
  expect(repo.getQueueRow(100, 10)!.attempts).toBe(2);
});
