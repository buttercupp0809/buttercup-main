import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import type { ReelItem } from "@/components/reels/ReelScroller";

const characterMediaFindMany = vi.fn();
const characterFindMany = vi.fn();
const reelLikeFindMany = vi.fn();
const reelLikeGroupBy = vi.fn();
const signAssetUrlMock = vi.fn((k: string) => `/api/media?k=${encodeURIComponent(k)}`);

vi.mock("@buttercupp/database", () => ({
  prisma: {
    characterMedia: { findMany: (...a: unknown[]) => characterMediaFindMany(...a) },
    character: { findMany: (...a: unknown[]) => characterFindMany(...a) },
    reelLike: {
      findMany: (...a: unknown[]) => reelLikeFindMany(...a),
      groupBy: (...a: unknown[]) => reelLikeGroupBy(...a),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: async () => undefined,
  getCurrentUser: async () => ({ id: "user-1" }),
}));

vi.mock("@/lib/cdn", () => ({
  signAssetUrl: (k: string) => signAssetUrlMock(k),
}));

// ReelScroller is a client component with side effects (next/navigation,
// lucide-react). Replace it with a plain marker so this test can inspect the
// items prop the server component passes down without pulling in browser bits.
vi.mock("@/components/reels/ReelScroller", () => ({
  ReelScroller: ({ items }: { items: ReelItem[] }) => ({ __marker: "reel-scroller", items }),
}));

const { default: ReelsPage } = await import("@/app/(protected)/reels/page");

beforeEach(() => {
  characterMediaFindMany.mockReset();
  characterFindMany.mockReset();
  reelLikeFindMany.mockReset();
  reelLikeGroupBy.mockReset();
  signAssetUrlMock.mockClear();
  characterMediaFindMany.mockResolvedValue([]);
  characterFindMany.mockResolvedValue([]);
  reelLikeFindMany.mockResolvedValue([]);
  reelLikeGroupBy.mockResolvedValue([]);
});

// Walk the React element tree returned by the async server component and
// find the ReelScroller marker (mocked above) so we can inspect its items.
function findScrollerItems(tree: unknown): ReelItem[] | null {
  if (!tree || typeof tree !== "object") return null;
  const el = tree as ReactElement & { props?: { items?: ReelItem[] } };
  const type = el.type as unknown;
  if (typeof type === "function") {
    const rendered = (type as (p: unknown) => unknown)(el.props);
    if (rendered && typeof rendered === "object" && "__marker" in rendered) {
      const marker = rendered as { __marker: string; items: ReelItem[] };
      if (marker.__marker === "reel-scroller") return marker.items;
    }
  }
  const props = el.props as { children?: unknown } | undefined;
  const children = props?.children;
  if (Array.isArray(children)) {
    for (const c of children) {
      const hit = findScrollerItems(c);
      if (hit) return hit;
    }
  } else if (children) {
    return findScrollerItems(children);
  }
  return null;
}

describe("ReelsPage manifest fallback", () => {
  it("routes every manifest src through signAssetUrl (never a raw /reels/ public path)", async () => {
    const jsx = await ReelsPage();
    const items = findScrollerItems(jsx);
    expect(items, "ReelScroller items must be found in the rendered tree").not.toBeNull();
    expect(items!.length).toBeGreaterThan(0);
    for (const it of items!) {
      expect(it.src.startsWith("/reels/"), `raw public path leaked: ${it.src}`).toBe(false);
      expect(it.src).toMatch(/^\/api\/media\?k=reels%2F\d+\.mp4$/);
    }
    expect(signAssetUrlMock).toHaveBeenCalled();
    for (const call of signAssetUrlMock.mock.calls) {
      expect(call[0]).toMatch(/^reels\/\d+\.mp4$/);
    }
  });
});
