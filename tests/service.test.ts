import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { createFilter } from "../src/filter";
import { DeleteItRepository } from "../src/repository";
import { DeleteItService, type TelegramApi } from "../src/service";

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
  expect(action).toEqual({ react: "👾", matchedEntry: "bad" });
}

test("banned message queues deletion and reacts", () => {
  const action = service.handleMessage({ chatId: 100, messageId: 10, text: "this is bad" });

  expect(action).toEqual({ react: "👾", matchedEntry: "bad" });
  const row = repo.getQueueRow(100, 10)!;
  expect(row.deleteAfter).toBe(1_700_000_060);
  expect(row.matchedWord).toBe("bad");
  expect(row.status).toBe("pending");
});

test("caption is queued the same way as text", () => {
  const action = service.handleMessage({ chatId: 100, messageId: 10, caption: "photo caption with bad word" });

  expect(action).toEqual({ react: "👾", matchedEntry: "bad" });
  expect(repo.getQueueRow(100, 10)!.deleteAfter).toBe(1_700_000_060);
});

test("queue stores the exact dictionary entry that triggered the ban, not the matched spelling", () => {
  const entryService = new DeleteItService(repo, createFilter(["роскомнадзор"]), { deleteDelaySeconds: 60, now: () => nowMs });

  const action = entryService.handleMessage({ chatId: 100, messageId: 10, text: "тут Р0СК0МНАДЗ0Р" });

  expect(action).toEqual({ react: "👾", matchedEntry: "роскомнадзор" });
  expect(repo.getQueueRow(100, 10)!.matchedWord).toBe("роскомнадзор");
});

test("clean message does not create a queue row or reaction", () => {
  expect(service.handleMessage({ chatId: 100, messageId: 10, text: "clean message" })).toBeUndefined();
  expect(repo.getQueueRow(100, 10)).toBeUndefined();
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
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteItReaction: true }, api());
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
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteItReaction: true }, api());
  nowMs += 61_000;
  const telegram = api();

  expect(await service.sweep(telegram)).toEqual([]);
  expect(telegram.deleted).toEqual([]);
});

test("deleting becomes eligible again after veto removal", async () => {
  service.handleMessage({ chatId: 100, messageId: 10, text: "bad" });
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteItReaction: true }, api());
  nowMs += 61_000;
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteItReaction: false }, api());
  const telegram = api();

  expect(await service.sweep(telegram)).toEqual([{ chatId: 100, messageId: 10, status: "deleted" }]);
  expect(telegram.deleted).toEqual([[100, 10]]);
  expect(repo.getQueueRow(100, 10)!.status).toBe("deleted");
});

test("multiple admin vetoes keep deletion paused until all are removed", async () => {
  service.handleMessage({ chatId: 100, messageId: 10, text: "bad" });
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteItReaction: true }, api());
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 2, hasDeleteItReaction: true }, api());
  nowMs += 61_000;
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteItReaction: false }, api());

  expect(await service.sweep(api())).toEqual([]);
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 2, hasDeleteItReaction: false }, api());
  expect(await service.sweep(api())).toEqual([{ chatId: 100, messageId: 10, status: "deleted" }]);
});

test("non-admin reaction does not affect deletion", async () => {
  service.handleMessage({ chatId: 100, messageId: 10, text: "bad" });
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteItReaction: true }, api("member"));
  nowMs += 61_000;
  const telegram = api();

  expect(await service.sweep(telegram)).toEqual([{ chatId: 100, messageId: 10, status: "deleted" }]);
});

test("admin reaction creates and removes veto", async () => {
  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteItReaction: true }, api())).toEqual({ vetoed: true });
  expect(repo.countVetoes(100, 10)).toBe(1);
  expect(await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteItReaction: false }, api())).toEqual({ vetoed: false });
  expect(repo.countVetoes(100, 10)).toBe(0);
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

  expect(await service.handleReaction({ chatId: 100, messageId: 10, hasDeleteItReaction: true }, telegram)).toEqual({ ignored: "anonymous" });
  expect(getChatMemberCalls).toBe(0);
  expect(repo.countVetoes(100, 10)).toBe(0);
});

test("admin veto is idempotent for repeated reaction updates", async () => {
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteItReaction: true }, api());
  await service.handleReaction({ chatId: 100, messageId: 10, userId: 1, hasDeleteItReaction: true }, api());

  expect(repo.countVetoes(100, 10)).toBe(1);
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
