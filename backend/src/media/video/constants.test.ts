import { describe, it, expect, afterEach } from "vitest";
import { WAN_FPS, VIDEO_ASPECTS, WAN_STEPS, videoSelfHostConfigured, VIDEO_FPS, VIDEO_ASPECTS_HQ, RIFE_MULTIPLIER, interpolatedFps } from "./constants";

describe("video constants (Wan additive)", () => {
  afterEach(() => {
    delete process.env.POPPY_WAN_URL;
    delete process.env.POPPY_VIDEO_ROUTER_URL;
  });

  it("keeps the cloud VIDEO_FPS at 24 (Fal/Replicate untouched)", () => {
    expect(VIDEO_FPS).toBe(24);
  });
  it("uses Wan-native 16 fps for the self-hosted path", () => {
    expect(WAN_FPS).toBe(16);
  });
  it("offers portrait/landscape/square aspect sizes at a 480p base, all divisible by 16", () => {
    expect(VIDEO_ASPECTS.portrait).toEqual({ width: 480, height: 832 });
    expect(VIDEO_ASPECTS.landscape).toEqual({ width: 832, height: 480 });
    expect(VIDEO_ASPECTS.square).toEqual({ width: 512, height: 512 });
    for (const size of Object.values(VIDEO_ASPECTS)) {
      expect(size.width % 16).toBe(0);
      expect(size.height % 16).toBe(0);
    }
  });
  it("fast preset is few-step, cfg 1.0, LoRA on both experts", () => {
    expect(WAN_STEPS.fast.high.steps + WAN_STEPS.fast.low.steps).toBeLessThanOrEqual(8);
    expect(WAN_STEPS.fast.high.cfg).toBe(1.0);
    expect(WAN_STEPS.fast.low.cfg).toBe(1.0);
    expect(WAN_STEPS.fast.high.loraStrength).toBe(1.0);
    expect(WAN_STEPS.fast.low.loraStrength).toBe(1.0);
  });
  it("balanced weakens the high-expert LoRA to 0.7 (motion) and keeps the low LoRA full at cfg 1.0", () => {
    expect(WAN_STEPS.balanced.high.cfg).toBe(3.5);
    expect(WAN_STEPS.balanced.high.loraStrength).toBe(0.7);
    expect(WAN_STEPS.balanced.low.cfg).toBe(1.0);
    expect(WAN_STEPS.balanced.low.loraStrength).toBe(1.0);
  });
  it("max runs both experts with no LoRA at higher cfg", () => {
    expect(WAN_STEPS.max.high.cfg).toBe(4.0);
    expect(WAN_STEPS.max.low.cfg).toBe(3.5);
    expect(WAN_STEPS.max.high.loraStrength).toBe(0);
    expect(WAN_STEPS.max.low.loraStrength).toBe(0);
  });
  it("self-host is configured when POPPY_WAN_URL is set", () => {
    process.env.POPPY_WAN_URL = "http://1.2.3.4:8188";
    expect(videoSelfHostConfigured()).toBe(true);
  });
});

describe("wan presets v2", () => {
  it("high-noise expert weakens (balanced) or drops (max) the Lightning LoRA; fast keeps it full", () => {
    expect(WAN_STEPS.balanced.high.loraStrength).toBeGreaterThan(0);
    expect(WAN_STEPS.balanced.high.loraStrength).toBeLessThan(1);
    expect(WAN_STEPS.max.high.loraStrength).toBe(0);
    expect(WAN_STEPS.fast.high.loraStrength).toBe(1.0);
  });
  it("interpolation on for balanced/max, off for fast", () => {
    expect(WAN_STEPS.balanced.interpolate).toBe(true);
    expect(WAN_STEPS.max.interpolate).toBe(true);
    expect(WAN_STEPS.fast.interpolate).toBe(false);
  });
  it("hq resolution only on max (balanced stays 480p for speed)", () => {
    expect(WAN_STEPS.max.hq).toBe(true);
    expect(WAN_STEPS.balanced.hq).toBe(false);
    expect(WAN_STEPS.fast.hq).toBe(false);
  });
  it("interpolated fps doubles native", () => {
    expect(interpolatedFps()).toBe(WAN_FPS * RIFE_MULTIPLIER);
    expect(RIFE_MULTIPLIER).toBe(2);
  });
  it("hq aspects are divisible by 16", () => {
    for (const a of Object.values(VIDEO_ASPECTS_HQ)) {
      expect(a.width % 16).toBe(0);
      expect(a.height % 16).toBe(0);
    }
  });
});
