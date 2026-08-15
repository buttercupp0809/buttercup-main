// Phase 30: nightly memory dreaming, ported from the sibling Pellow project.
// Clusters recent memories for a (userId, characterId) pair, then per
// cluster derives edges and an optional insight memory. Never deletes.
//
// Design lineage: Supermemory (typed-relation graph) and Mem0
// (extract-then-consolidate memory layer with graph links). Never runs on
// the hot chat-turn path; only from the manual/scheduled script
// (backend/src/scripts/run-dreaming.ts). Behind memoryDreamingEnabled().
//
// Poppy has no isLatest/isArchived/supersededById columns on Memory (no
// supersession machinery), so the contradiction-supersession branch Pellow
// has is intentionally SKIPPED here. TODO(phase-30-followup): add those
// columns in a future additive migration and implement supersession if
// dreaming-derived contradiction detection proves useful in practice.

import { prisma } from "@buttercupp/database";
import { cosineSimilarity } from "../llm/embeddings";
import { callLLM } from "../llm/provider";
import { wordOverlap } from "../llm/memory-extractor";
import { writeMemory } from "./store";
import { memoryDreamingEnabled } from "../config/flags";
import { incrementCounter } from "../metrics";
import { logInfo, logWarn } from "../utils/log";

const CLUSTER_THRESHOLD = 0.55;
const CLUSTER_MIN = 2;
const CLUSTER_MAX = 8;
const MAX_CLUSTERS_PER_PAIR = 5;
const MAX_INSIGHTS_PER_PAIR = 3;
const INSIGHT_DEDUP_OVERLAP = 0.6;

interface MemRow {
  id: string;
  content: string;
  createdAt: Date;
  category: string;
  importance: number;
  embedding: number[] | null;
}

interface ClusterLLMOut {
  derivedEdges?: { sourceContent?: string; targetContent?: string; label?: string }[];
  insight?: { content?: string; category?: string; importance?: "low" | "medium" | "high" };
}

const CLUSTER_SYSTEM_PROMPT = `You analyze a small cluster of related memories about ONE user. Output ONLY strict JSON, no prose. Schema:
{"derivedEdges":[{"sourceContent":"...","targetContent":"...","label":"..."}],"insight":{"content":"...","category":"identity|preference|goal|fear|history|relationship|routine|emotion|trivia","importance":"low|medium|high"}}
- derivedEdges: only when TWO memories in the cluster imply each other or one derives from the other. sourceContent and targetContent MUST be exact substrings copied from the input.
- insight: at most one. A single non-obvious observation the user has not been told, drawn from the cluster. Skip if nothing new.
Output the object with an empty derivedEdges array / omitted insight when nothing applies.`;

function parseClusterOut(raw: string): ClusterLLMOut | null {
  try {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    if (s === -1 || e === -1) return null;
    return JSON.parse(cleaned.slice(s, e + 1)) as ClusterLLMOut;
  } catch {
    return null;
  }
}

function importanceOf(level: "low" | "medium" | "high" | undefined): number {
  if (level === "low") return 0.3;
  if (level === "high") return 0.85;
  return 0.6;
}

// Deterministic greedy clustering. Sort by createdAt ascending so runs on the
// same input produce identical clusters. Each memory joins the first existing
// cluster whose centroid is within threshold, else opens a new cluster.
function clusterMemories(mems: MemRow[], maxClusters = MAX_CLUSTERS_PER_PAIR): MemRow[][] {
  const ordered = mems
    .filter((m) => Array.isArray(m.embedding) && m.embedding.length > 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const clusters: { members: MemRow[]; centroid: number[] }[] = [];
  for (const m of ordered) {
    let best: { idx: number; sim: number } | null = null;
    for (let i = 0; i < clusters.length; i++) {
      const sim = cosineSimilarity(m.embedding!, clusters[i].centroid);
      if (sim >= CLUSTER_THRESHOLD && (!best || sim > best.sim)) {
        best = { idx: i, sim };
      }
    }
    if (best && clusters[best.idx].members.length < CLUSTER_MAX) {
      const c = clusters[best.idx];
      c.members.push(m);
      const dim = c.centroid.length;
      const next = new Array<number>(dim).fill(0);
      for (const x of c.members) {
        for (let j = 0; j < dim; j++) next[j] += x.embedding![j];
      }
      for (let j = 0; j < dim; j++) next[j] /= c.members.length;
      c.centroid = next;
    } else {
      clusters.push({ members: [m], centroid: [...m.embedding!] });
    }
  }
  return clusters
    .filter((c) => c.members.length >= CLUSTER_MIN)
    .slice(0, maxClusters)
    .map((c) => c.members);
}

async function loadPairMemories(userId: string, characterId: string, sinceDays: number, limit: number): Promise<MemRow[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 200;
  const rows = await prisma.$queryRaw<
    { id: string; content: string; createdAt: Date; category: string; importance: number; embedding: string | null }[]
  >`
    SELECT id, content, "createdAt", category, importance, embedding::text AS embedding
    FROM "Memory"
    WHERE "userId" = ${userId}
      AND "characterId" = ${characterId}
      AND "tier" <> 'cold'
      AND "createdAt" >= ${since}
    ORDER BY "createdAt" ASC
    LIMIT ${safeLimit}
  `;
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    createdAt: r.createdAt,
    category: r.category,
    importance: Number(r.importance),
    embedding: r.embedding
      ? r.embedding
          .replace(/[[\]]/g, "")
          .split(",")
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n))
      : null,
  }));
}

function findMemberByContent(members: MemRow[], content: string): MemRow | null {
  const c = content.trim();
  const exact = members.find((m) => m.content.trim() === c);
  if (exact) return exact;
  const partial = members.find(
    (m) => m.content.includes(c) || c.includes(m.content) || wordOverlap(m.content, c) >= 0.7,
  );
  return partial ?? null;
}

async function processCluster(
  userId: string,
  characterId: string,
  cluster: MemRow[],
  existingContents: string[],
  insightsCreatedThisRun: { current: number },
): Promise<{ edges: number; insights: number; supersessions: number }> {
  const numbered = cluster.map((m, i) => `${i + 1}. ${m.content}`).join("\n");
  let raw = "";
  try {
    const { text } = await callLLM({
      purpose: "extract",
      systemPrompt: CLUSTER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Cluster of memories:\n${numbered}` }],
      maxTokens: 500,
      temperature: 0,
      timeoutMs: 15000,
    });
    raw = text;
  } catch (err) {
    logWarn("dreaming", "LLM call failed", { reason: err instanceof Error ? err.message : String(err) });
    return { edges: 0, insights: 0, supersessions: 0 };
  }
  const parsed = parseClusterOut(raw);
  if (!parsed) return { edges: 0, insights: 0, supersessions: 0 };

  let edges = 0;
  let insights = 0;
  // Supersession is not implemented (see file header TODO): poppy's Memory
  // model has no isLatest/supersededById columns to write to.
  const supersessions = 0;

  for (const de of parsed.derivedEdges ?? []) {
    if (!de.sourceContent || !de.targetContent) continue;
    const src = findMemberByContent(cluster, de.sourceContent);
    const tgt = findMemberByContent(cluster, de.targetContent);
    if (!src || !tgt || src.id === tgt.id) continue;
    try {
      await prisma.memoryEdge.create({
        data: {
          userId,
          characterId,
          sourceId: src.id,
          targetId: tgt.id,
          relation: "derives",
          weight: 0.7,
          label: de.label?.slice(0, 100) ?? null,
          createdBy: "dreaming",
        },
      });
      edges++;
    } catch {
      // unique-constraint duplicate, ignore
    }
  }

  const ins = parsed.insight;
  if (
    ins &&
    typeof ins.content === "string" &&
    ins.content.trim().length > 8 &&
    insightsCreatedThisRun.current < MAX_INSIGHTS_PER_PAIR
  ) {
    const insightText = ins.content.trim();
    const isDupe = existingContents.some((c) => wordOverlap(c, insightText) >= INSIGHT_DEDUP_OVERLAP);
    if (!isDupe) {
      const category =
        typeof ins.category === "string" && ins.category.length > 0 ? ins.category : "trivia";
      const insightMemoryId = await writeMemory({
        userId,
        characterId,
        content: insightText,
        category,
        importance: importanceOf(ins.importance),
        confidence: 0.6,
        tier: "warm",
      });
      for (const m of cluster) {
        try {
          await prisma.memoryEdge.create({
            data: {
              userId,
              characterId,
              sourceId: insightMemoryId,
              targetId: m.id,
              relation: "derives",
              weight: 0.6,
              createdBy: "dreaming",
            },
          });
        } catch {
          // duplicate, ignore
        }
      }
      insights++;
      insightsCreatedThisRun.current++;
    }
  }

  return { edges, insights, supersessions };
}

export interface DreamingTotals {
  edges: number;
  insights: number;
  supersessions: number;
}

export interface DreamingOptions {
  sinceDays?: number;
  maxClusters?: number;
}

export async function runDreamingForUser(
  userId: string,
  characterId: string,
  opts?: DreamingOptions,
): Promise<DreamingTotals> {
  const empty: DreamingTotals = { edges: 0, insights: 0, supersessions: 0 };
  if (!memoryDreamingEnabled()) return empty;
  const mems = await loadPairMemories(userId, characterId, opts?.sinceDays ?? 7, opts?.sinceDays ? 2000 : 200);
  if (mems.length < CLUSTER_MIN) return empty;
  const clusters = clusterMemories(mems, opts?.maxClusters ?? MAX_CLUSTERS_PER_PAIR);
  if (clusters.length === 0) return empty;

  const existingContents = mems.map((m) => m.content);
  const insightsCreatedThisRun = { current: 0 };
  let totalEdges = 0;
  let totalInsights = 0;
  let totalSupersessions = 0;

  for (const cluster of clusters) {
    const r = await processCluster(userId, characterId, cluster, existingContents, insightsCreatedThisRun);
    totalEdges += r.edges;
    totalInsights += r.insights;
    totalSupersessions += r.supersessions;
  }

  if (totalEdges > 0) incrementCounter("dreaming_edges_created", totalEdges);
  if (totalInsights > 0) incrementCounter("dreaming_insights_created", totalInsights);
  if (totalSupersessions > 0) incrementCounter("dreaming_supersessions", totalSupersessions);
  return { edges: totalEdges, insights: totalInsights, supersessions: totalSupersessions };
}

export interface DreamingRunSummary extends DreamingTotals {
  pairsProcessed: number;
  failures: number;
}

// Iterates every (userId, characterId) pair with at least one Memory row in
// the last 24h. Local/manual invocation only (backend/src/scripts/run-dreaming.ts);
// never scheduled onto the hot chat-turn path.
export async function runDreamingForAllPairs(): Promise<DreamingRunSummary> {
  if (!memoryDreamingEnabled()) {
    return { pairsProcessed: 0, failures: 0, edges: 0, insights: 0, supersessions: 0 };
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<{ userId: string; characterId: string }[]>`
    SELECT DISTINCT "userId", "characterId"
    FROM "Memory"
    WHERE "createdAt" >= ${since}
  `;
  const CONCURRENCY = 2;
  let i = 0;
  let processed = 0;
  let failures = 0;
  const totals: DreamingTotals = { edges: 0, insights: 0, supersessions: 0 };
  async function worker() {
    while (i < rows.length) {
      const idx = i++;
      const pair = rows[idx];
      const t0 = Date.now();
      try {
        const r = await runDreamingForUser(pair.userId, pair.characterId);
        totals.edges += r.edges;
        totals.insights += r.insights;
        totals.supersessions += r.supersessions;
        processed++;
      } catch (err) {
        failures++;
        logWarn("dreaming", `pair ${pair.userId}/${pair.characterId} failed`, {
          reason: err instanceof Error ? err.message : String(err),
        });
      } finally {
        logInfo("dreaming", `pair ${pair.userId}/${pair.characterId} done in ${Date.now() - t0}ms`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));
  incrementCounter("dreaming_pairs_processed", processed);
  if (failures > 0) incrementCounter("dreaming_failures", failures);
  return { pairsProcessed: processed, failures, ...totals };
}

// Test-only helper.
export const _internal = { clusterMemories, findMemberByContent, parseClusterOut };
