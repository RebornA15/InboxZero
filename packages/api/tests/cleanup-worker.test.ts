import { afterEach, describe, expect, it, vi } from "vitest";
import { startCleanupWorker, stopCleanupWorker } from "../src/lib/cleanup.js";

const database = vi.hoisted(() => ({ where: vi.fn() }));
vi.mock("../src/config.js", () => ({ config: { NODE_ENV: "production", CLEANUP_INTERVAL_MS: 10000 } }));
vi.mock("../src/db/index.js", () => ({ db: { select: () => ({ from: () => ({ where: database.where }) }) } }));
afterEach(() => { stopCleanupWorker(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("cleanup connection failures", () => {
  it("logs a sanitized failure then retries successfully on the next interval", async () => {
    vi.useFakeTimers();
    database.where.mockRejectedValueOnce(Object.assign(new Error("secret-fixture"), { code: "ENOTFOUND" })).mockResolvedValue([]);
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    startCleanupWorker(); startCleanupWorker();
    await vi.advanceTimersByTimeAsync(10000);
    expect(database.where).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(output.mock.calls)).toContain("dns_lookup_failed");
    expect(JSON.stringify(output.mock.calls)).not.toContain("secret-fixture");
    await vi.advanceTimersByTimeAsync(10000);
    expect(database.where).toHaveBeenCalledTimes(2);
    expect(output).toHaveBeenCalledTimes(1);
    stopCleanupWorker();
    await vi.advanceTimersByTimeAsync(10000);
    expect(database.where).toHaveBeenCalledTimes(2);
  });
  it("does not overlap slow cleanup jobs", async () => {
    vi.useFakeTimers(); database.where.mockClear();
    let finish!: (rows: never[]) => void;
    database.where.mockReturnValueOnce(new Promise<never[]>(resolve => { finish = resolve; })).mockResolvedValue([]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    startCleanupWorker();
    await vi.advanceTimersByTimeAsync(30000);
    expect(database.where).toHaveBeenCalledTimes(1);
    finish([]); await Promise.resolve(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10000);
    expect(database.where).toHaveBeenCalledTimes(2);
  });
});
