import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

describe("frontend deployment URL and fetch SSE", () => {
  it("retains same-origin /api when the build variable is empty", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    const fetch = vi.fn().mockResolvedValue(Response.json({ categories: [] }));
    vi.stubGlobal("fetch", fetch);
    const api = await import("../../web/src/api.ts");
    await api.getAddressOptions();
    expect(fetch.mock.calls[0][0]).toBe("/api/inboxes/options");
  });
  it("uses the production base for every HTTP endpoint and the authenticated SSE stream", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://inboxzero-api.onrender.com/api/");
    const fetch = vi.fn().mockImplementation(async () => Response.json({ inbox: {}, messages: [], message: {}, accessSecret: "secret" }));
    vi.stubGlobal("fetch", fetch);
    const api = await import("../../web/src/api.ts");
    await api.getAddressOptions(); await api.createInbox(); await api.getInbox("id", "secret");
    await api.getMessages("id", "secret"); await api.getMessage("id", 1, "secret");
    await api.deleteMessage("id", 1, "secret"); await api.simulateIncomingMail("id", "secret", "subject");
    fetch.mockImplementationOnce(async () => new Response(null, { status: 401 }));
    const close = api.connectInboxEvents("id", "secret", vi.fn(), vi.fn());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(8)); close();
    for (const call of fetch.mock.calls) expect(call[0]).toMatch(/^https:\/\/inboxzero-api\.onrender\.com\/api\/inboxes/);
    expect(fetch.mock.calls[7][1].headers["X-Access-Secret"]).toBe("secret");
  });
  it("reconnects after an interrupted stream and cancels scheduled retries on cleanup", async () => {
    vi.useFakeTimers(); vi.stubEnv("VITE_API_BASE_URL", "");
    const fetch = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetch);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = await import("../../web/src/api.ts");
    const close = api.connectInboxEvents("id", "secret", vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(1000); expect(fetch).toHaveBeenCalledTimes(2);
    close(); await vi.advanceTimersByTimeAsync(60000); expect(fetch).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
