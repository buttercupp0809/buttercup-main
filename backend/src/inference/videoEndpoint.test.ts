import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { videoConfigured, resolveVideoBaseUrl, _resetVideoEndpointCache } from "./videoEndpoint";

describe("videoEndpoint", () => {
  beforeEach(() => {
    _resetVideoEndpointCache();
    delete process.env.POPPY_WAN_URL;
    delete process.env.POPPY_VIDEO_ROUTER_URL;
  });
  afterEach(() => vi.restoreAllMocks());

  it("is not configured when neither env is set", () => {
    expect(videoConfigured()).toBe(false);
  });

  it("returns the static URL without trailing slash", async () => {
    process.env.POPPY_WAN_URL = "http://10.0.0.5:8188/";
    expect(videoConfigured()).toBe(true);
    expect(await resolveVideoBaseUrl()).toBe("http://10.0.0.5:8188");
  });

  it("wakes via the router and returns host:8188", async () => {
    process.env.POPPY_VIDEO_ROUTER_URL = "https://router.example";
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: "ready", ip: "9.9.9.9" }), { status: 200 }));
    expect(await resolveVideoBaseUrl()).toBe("http://9.9.9.9:8188");
    expect(fetchMock).toHaveBeenCalled();
  });
});
