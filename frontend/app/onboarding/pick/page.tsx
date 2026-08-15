import { getViewer } from "@/lib/viewer";
import { getDashboardFeed } from "@/lib/feed";
import { viewerAllowsMature } from "@buttercupp/database";
import type { CharacterCardDTO } from "@buttercupp/shared";
import { Recommendations } from "./Recommendations";

// Server wrapper: reuses the exact dashboard feed data path so a viewer never
// sees a card the gallery itself would hide. buildCharacterWhere already
// excludes mature cards for a viewer who is not permitted (see
// packages/database/src/queries/characters.ts), so this list is safe as-is;
// `mature` is still threaded through to CharacterCard for the same
// defense-in-depth blur/gate treatment the dashboard uses.
//
// v1 ordering: a simple curated slice (first N unique cards across the
// existing "For you" / "New" / "Trending" sections). Biasing by the draft's
// vibe/interests would require reading client-only localStorage state from
// this server component, which is not available here; left as a future
// enhancement once preferences are persisted before this step.
export default async function OnboardingPickStep() {
  const viewer = await getViewer();
  const feed = await getDashboardFeed(viewer);
  const mature = viewerAllowsMature(viewer);

  const seen = new Set<string>();
  const items: CharacterCardDTO[] = [];
  for (const section of feed.sections) {
    for (const item of section.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length >= 8) break;
    }
    if (items.length >= 8) break;
  }

  return <Recommendations items={items} viewerAllowsMature={mature} />;
}
