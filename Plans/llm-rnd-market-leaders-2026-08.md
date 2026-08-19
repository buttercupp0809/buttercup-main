# LLM R&D: Market Leaders and Next-Model Trial Recommendation (2026-08)

Status: Research deliverable only. No change to `backend/src/llm/*`. Deploying a
new served model is a separate, approval-gated GPU operation and is out of scope
for this document.

## 1. Why this doc exists

ButterCupp currently serves `L3-8B-Stheno-v3.2` (Q5_K_M GGUF) from a self-hosted
llama.cpp OpenAI-compatible endpoint on a single 24 GB A10G, co-located with
Juggernaut XL for image generation. OpenRouter (`nousresearch/hermes-3-llama-3.1-70b`)
is the mature-content fallback, then Anthropic Sonnet / OpenAI GPT-4o-mini, then
a hardcoded string. See `backend/src/llm/constants.ts`, `backend/src/llm/provider.ts`,
`Plans/model-hosting-aws-cost-analysis.md`.

Stheno 3.2 8B is a strong 8B-class RP model (see `Plans/llm-list.md`, section 7),
but it is now two generations behind the SillyTavern / OpenRouter default stacks
that companion products either self-host or rent. The purpose here is to survey
what the market leaders actually run in 2026, score credible upgrade candidates
against our real hardware and latency constraints, and pick one to A/B behind
`POPPY_CHAT_MODEL` without touching code.

## 2. Constraints we are picking against

Sourced from `Plans/prds/master-prd.md`, `backend/src/llm/constants.ts`,
`backend/src/llm/provider.ts`, and `Plans/model-hosting-aws-cost-analysis.md`.

- Content: uncensored NSFW roleplay, first-person persona, long-form prose. No
  refusals, no fade-to-black, no policy lectures.
- Context: 8k tokens minimum, ideally 16k+. Chat compaction and Story Memory
  layers already trim history, so 32k+ is a nice-to-have, not a hard need.
- Hardware: 24 GB A10G (`g5.xlarge`, eu-north-1c). Juggernaut XL peaks ~8-10 GB
  during image generation and idles lower; system RAM (16 GB + 16 GB swap) is
  the real ceiling on the box, not VRAM.
- Latency: first-token target under 1 s p50 / 2 s p95 (master PRD, row "Chat
  first-token latency"), turn budget capped by the 12 s Poppy fast-fail
  (`POPPY_TIMEOUT_MS` in `provider.ts`, line ~231). Anything that streams first
  token past ~1.5 s on the A10G at expected concurrency is disqualified.
- Ops: model must run under llama.cpp GGUF today (that is what the box has) OR
  be reachable via a stable OpenRouter slug so we can trial without touching
  the box.
- Cost: prefer $0 marginal for self-hosted (the box is 24/7 anyway) or cheap
  OpenRouter (Stheno-class pricing, well under the mature-content Hermes-3-70B
  fallback we already pay for).

## 3. Market landscape summary

There are two dominant patterns among the named products.

Pattern A: proprietary in-house LLM, self-served. Character.AI (Kaiju family:
13B / 34B / 110B dense transformers with int8 QAT, multi-query attention, sliding
window, cross-layer KV sharing; product-facing models are DeepSqueak and PipSqueak
/ PSQ2 in 2026) [1][2][3]. Replika (in-house LLMs since moving off GPT-3 in 2022;
"Advanced AI Mode" (2023) is "dozens of billions of parameters"; Replika 2.0
rebuild in April 2026 is a fresh backbone, still not disclosed) [4][5]. JanitorAI
(JLLM; base architecture swapped April 20 2026 to a new backbone tuned on Gemini
and Opus outputs, JLLM V2 in training on a B200 cluster) [6][7]. Neither Character.AI
nor Replika nor Janitor publish weights, params, or slugs. All three are
irrelevant as things we can "adopt" and useful only as a north star for the
felt quality bar.

Pattern B: open-weight fine-tune, self-hosted or rented, often user-swappable.
SpicyChat exposes a model picker: default 8B, TheSpice 8B (Llama-3), Stheno,
Lyra 12B v4, Magnum 72B, WizardLM-2 8x22B, SpicyXL (branded ~132B in-house), plus
DeepSeek and Kimi K2 on the top tier [8][9]. CrushOn.AI advertises a 13+ model
picker including Claude Opus, GLM 5.2, DeepSeek V4 alongside open-weight
fine-tunes (Mythomax historically); routing is per-user [10][11][12]. Candy.AI
does not disclose but community teardowns strongly suggest a Llama 3.x or
Mistral fine-tune, self-hosted, with per-character LoRA hot-swap for image
consistency, plus GPT-4o class fallback for SFW [13][14][15]. DreamGF and Muah.AI
are in the same bucket, both text-only teardowns pointing at Llama / Mistral
fine-tunes plus SDXL for images [16][17]. Full BYOK-front-ends (Janitor's BYOK
mode, SillyTavern) are also pattern B in practice: the community consensus for
2026 sits on Sao10K Euryale 70B, TheDrummer Anubis 70B, TheDrummer Cydonia 24B,
Venice Uncensored (Dolphin Mistral 24B), and DeepSeek V3/V4 via OpenRouter or
Featherless [18][19][20].

Takeaway for us: we are already firmly in pattern B. The right move is to stop
running an 8B-class base and move to the 12B-24B open-weight RP class that has
become the SillyTavern / OpenRouter default, either on the box (self-host) or
via a cheap OpenRouter slug.

## 4. Candidates scored against our constraints

VRAM figures are for Q4_K_M or Q5_K_M GGUF at 8k KV cache on A10G, taking
Juggernaut XL peaks into account. Latency estimates are first-token p50 on
llama.cpp with all layers on GPU, extrapolated from Stheno's live behavior (the
8B baseline streams first token in a few hundred ms on the A10G, so we scale by
active-params ratio for comparable quantization).

| Candidate | Params | Base | Ctx | Q5_K_M VRAM (approx) | Fit on 24 GB with Juggernaut | Self-host | OpenRouter slug | Uncensored quality | RP prose | Est first-token p50 on A10G | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L3-8B-Stheno-v3.2 (baseline) | 8B | Llama 3 | 8k | ~5.7 GB | comfortable | yes (current) | yes (via Sao10K) | good | good, dated | ~300-500 ms | $0 marginal |
| Sao10K L3 Lunaris 8B | 8B | Llama 3 | 8k | ~5.7 GB | comfortable | yes | `sao10k/l3-lunaris-8b` | good | slightly cleaner than Stheno per Sao10K | ~300-500 ms | ~$0.04/$0.05 per M in/out on OR [19] |
| Sao10K L3 Stheno v3.3 32K | 8B | Llama 3 | 32k | ~6-7 GB with 32k KV | comfortable | yes | via OR | good | same family, longer ctx | ~400 ms | Stheno-class |
| Rocinante v1.1 12B (Drummer) | 12B | Mistral Nemo | 32k | ~8-9 GB | comfortable, headroom for Juggernaut | yes | yes (multiple mirrors) | very good | strong prose, forward, "hornier" [21] | ~500-800 ms | $0 self-host |
| NemoMix-Unleashed 12B | 12B | Mistral Nemo | 32k | ~8-9 GB | comfortable | yes | limited | very good | creative, fast prose (see `Plans/llm-list.md` 3) | ~500-800 ms | $0 self-host |
| Magnum v4 22B | 22B | Mistral Small 24B | 32k | ~14 GB at Q4_K_M [21] | tight, needs Juggernaut off-GPU during chat or Q4 quant + smaller KV | yes (with care) | via Featherless / OR | excellent, "24 GB-class default" [21] | best-in-class 24B RP prose | ~800 ms - 1.4 s | $0 self-host, ~Mistral-class on OR |
| Cydonia 24B v4.1 (Drummer) | 24B | Mistral Small 3.2 | 131k | ~14-16 GB at Q4_K_M [22] | tight, same caveat as Magnum | yes | Featherless, some OR mirrors [20] | excellent, uncensored by design | strong, cinematic, native long-ctx [22] | ~800 ms - 1.4 s | $0 self-host |
| Venice Uncensored (Dolphin Mistral 24B Venice) | 24B | Mistral Small 24B | 128k | ~14 GB at Q4_K_M | tight | yes (GGUF) | `venice/uncensored` (free tier: $0 up to 200 rpd) [23][19] | excellent, ships as "no safety" [23] | strong, Mistral prose | ~800 ms - 1.4 s local; OR latency dominates hosted | $0 free tier on OR |
| Sao10K Euryale 70B (v2.2 / L3.3) | 70B | Llama 3.3 | 128k | not viable on 24 GB (needs ~40 GB Q4) | no self-host | no | `sao10k/l3.3-euryale-70b` [18] | excellent | very strong | 2-4 s on OR (single NextBit provider, 7 tps) [18] | $0.65 / $0.75 per M on OR [18] |
| TheDrummer Anubis 70B v1.2 | 70B | Llama 3.1 | 128k | not viable | no | via Featherless [20] | excellent, long-form RP-tuned [20] | very strong | 2-4 s hosted | Featherless flat sub |
| Hermes-3 Llama-3.1 70B (current mature fallback) | 70B | Llama 3.1 | 128k | not viable | no | yes on OR (current) | `nousresearch/hermes-3-llama-3.1-70b` | good, lightly-censored | good, less RP-tuned | 2-4 s hosted | already-paid |
| DeepSeek V3 / V4 Flash | MoE ~284B / 13B active | DeepSeek | 128k-1M | not viable to self-host on A10G | no | OR / Featherless [19][20] | good with prompt (varies) | crowd favorite on Janitor BYOK [24] | first-token 1-2 s hosted | cheap-ish per M on OR |

Sources cited inline: `[N]` refers to the numbered citations in section 8.

Reconciliation with `Plans/llm-list.md`: that doc lists Midnight Rose 70B,
Midnight Miqu 70B, Magnum v4 (all sizes), Mistral-Small-22B ArliAI RPMax, Cydonia
22B, NemoMix-Unleashed 12B, Behemoth 123B, Monstral 123B, Lumimaid 70B, Command
R+ 104B, Gemma-2-27B, EVA Qwen 2.5 32B / 72B, Stheno 3.2 8B, Llama 3.1 base, and
several other 70B-123B options. Of those, the ones that actually fit our 24 GB
box co-located with Juggernaut are the 8B-12B and (tightly, with care) 22-24B
tier: Stheno, NemoMix-Unleashed 12B, Magnum v4 22B, Cydonia 22B (superseded here
by Cydonia 24B v4.1), Mistral-Small-22B RPMax, and Gemma-2-27B on the edge. The
70B-123B options in `llm-list.md` are OpenRouter- or Featherless-only for us,
which lines up with how we already treat Hermes-3 70B in the fallback chain.

## 5. Ranked recommendation

1. Cydonia 24B v4.1 (`TheDrummer/Cydonia-24B-v4.1`) via self-host on the A10G,
   Q4_K_M GGUF, 8k context. Rationale: purpose-built uncensored roleplay
   fine-tune of Mistral Small 3.2 24B, native 131k context (we cap at 8k for
   VRAM headroom), documented character-voice consistency and cinematic prose,
   and the community consensus 24 GB-class successor to the 8B / 12B tier that
   Stheno sits in [22]. Pairs cleanly with our llama.cpp serving stack. Live
   VRAM budget: Cydonia Q4_K_M ~14 GB + 8k KV ~1-2 GB + Juggernaut idle ~4 GB
   + Juggernaut peak headroom means we may need to serialize image generation
   against chat under load (already how the box behaves in practice per
   `Plans/model-hosting-aws-cost-analysis.md`, section 4b).
2. Rocinante v1.1 12B (`TheDrummer/Rocinante-12B-v1.1`) via self-host, Q5_K_M
   GGUF, 16k context. Rationale: the safe upgrade. Fits with no VRAM stress
   (~8-9 GB), preserves Juggernaut peaks, Mistral Nemo base is strong on RP
   prose, 32k native context. Best "low-regret" swap if Cydonia's VRAM turns
   out to push Juggernaut into swap under real image load.
3. Sao10K L3 Lunaris 8B via OpenRouter (`sao10k/l3-lunaris-8b`). Rationale:
   the cheapest possible A/B (~$0.04/$0.05 per M tokens per OR listings [19]),
   same 8B tier as Stheno but Sao10K's own "improved over Stheno v3.2" merge.
   Useful as a control arm to isolate "8B-Sao10K" quality against Stheno before
   we spend the VRAM on Cydonia.
4. Sao10K Euryale 70B via OpenRouter (`sao10k/l3.3-euryale-70b`). Rationale:
   the ceiling arm. Confirms whether a real 70B RP-tuned model wins on quality
   enough to justify the ~2-4 s first-token latency [18]. If Euryale beats
   Cydonia on qualitative RP but Cydonia comes close, self-hosting Cydonia is
   the right long-term posture. If neither beats Hermes-3 70B in blind RP, we
   are done chasing this branch and should focus on prompt / memory work
   instead.

## 6. How to A/B without a code change

The chat model on the self-hosted provider is env-selectable at process start
via `POPPY_CHAT_MODEL` (`backend/src/llm/provider.ts`, `modelFor()` around line
314-317: `return process.env.POPPY_CHAT_MODEL ?? MODELS.POPPY_STHENO_CHAT`). The
llama.cpp server serves whatever GGUF is currently loaded regardless of the
model name string, so the env var is a pass-through label that mostly shows up
in logs / metrics.

To A/B on the GPU box:

1. Have someone with GPU-box access (separate approval, per repo guardrails)
   place the candidate GGUF on the box and restart llama.cpp against it. That
   is the approval-gated GPU op that this document explicitly does not do.
2. Once served, set `POPPY_CHAT_MODEL` to the human label we want in logs
   (e.g. `Cydonia-24B-v4.1-Q4_K_M`). Restart the backend process (or the
   relevant frontend if it also runs the LLM path). No code change, no
   deploy, no migration.
3. To A/B via OpenRouter instead (no GPU-box work at all), point the
   `openrouter` provider slug at the candidate for the chat purpose. That is
   currently `MODELS.OPENROUTER_UNCENSORED_CHAT` in `constants.ts`. Since
   `constants.ts` is code, swapping that value IS a code change and is out of
   scope for this doc; the pattern to preserve "no code change" would be to
   add an env override read at `modelFor(provider="openrouter", purpose="chat")`
   time, mirroring `POPPY_CHAT_MODEL`, in the separate follow-up prompt that
   actually touches `backend/src/llm/*`.

Metrics to capture during A/B (all already emitted by `provider.ts` via
`recordLatency`, `recordProviderOutcome`, `incrementCounter`):

- First-token latency p50 / p95 (`llm:chat` latency, split by provider label).
- End-of-stream latency p50 / p95.
- Fallback rate: `%` of turns that fall through Poppy to OpenRouter or beyond.
- Provider health: circuit-breaker trips per candidate.
- Qualitative: at least 20 canned RP prompts (persona intro, escalation, NSFW,
  long-form continuation, memory-recall) blind-rated by two humans against
  Stheno baseline. Track refusal rate, in-character drift, repetition loops.
- Cost per 1k turns for OpenRouter arms.

Kill criteria (any one is enough to reject the candidate):

- First-token p95 above 2 s sustained on the A10G under normal load.
- Refusal / soft-refusal rate above Stheno baseline on the NSFW subset.
- Fallback rate above ~5% (indicates the box is thrashing under Juggernaut
  contention).

## 7. Out of scope (explicit)

Deploying a new served model on the GPU box is a separate, approval-gated GPU
operation. That includes: downloading GGUF weights to the box, restarting
llama.cpp against a new file, changing the box's systemd unit, and any
`POPPY_CHAT_MODEL` env change that lands in production. This document is a
research deliverable only. It intentionally does not touch `backend/src/llm/*`,
does not commit, and does not push.

## 8. Citations

1. Character.AI blog, "Inside Kaiju: building conversational models at scale":
   https://blog.character.ai/inside-kaiju-building-conversational-models-at-scale/
2. Character.AI blog, "Optimizing AI Inference at Character.AI":
   https://blog.character.ai/optimizing-ai-inference-at-character-ai-2/
3. Character.AI blog, "April Update: New Model, Memory, and Lorebook" (PipSqueak 2 / PSQ2, DeepSqueak):
   https://blog.character.ai/pipsqueak2-and-more/
4. Replika model history (GPT-3, GPT2-XL, Advanced AI Mode, Replika 2.0):
   https://aicompanionpick.com/replika-alpha-vs-previous-models
5. Dr. Alan D. Thompson, LifeArchitect.ai, Replika model notes:
   https://lifearchitect.ai/replika/
6. JanitorAI newsroom / changelog (April 20 2026 JLLM base swap):
   https://janitorai.com/news/changelog
7. RoboRhythms, "JanitorAI JLLM Quality Drop in May 2026 Explained" (B200 cluster, JLLM V2):
   https://www.roborhythms.com/janitor-ai-jllm-quality-drop-may-2026/
8. SpicyChat docs, "AI Models":
   https://docs.spicychat.ai/product-guides/premium-features/ai-models
9. Nastia review of SpicyChat 2026 (Glam series backend):
   https://www.nastia.ai/blog/spicychat-ai
10. CrushOn.AI landing (model picker, Opus / GLM / DeepSeek):
    https://chat.crushon.ai/
11. Cyberliebe review of CrushOn.AI (GPT-4o, Claude, MythoMax multi-model):
    https://cyberliebe.com/crushon-ai-review
12. StartupHub AI Girlfriend Apps 2026 roundup:
    https://www.startuphub.ai/ai-news/reviews/2026/best-ai-girlfriend-apps-2026
13. NSFW Coders, "What AI Models Power OurDream.ai and Candy AI?":
    https://nsfwcoders.com/blogs/technical/what-ai-model-does-ourdream-and-candy-ai-use/
14. MakeAnAppLike, "Candy.ai Revenue 2026 breakdown":
    https://makeanapplike.com/article/ai-llm/candy-ai-revenue-breakdown-how-ai-companion-apps-make-millions
15. Cypherox, "Candy AI Clone Development Guide 2026" (Llama 3.3 70B fine-tune stack pattern):
    https://www.cypherox.com/blog/candy-ai-clone-development-guide
16. AI Companion Picker, "CrushOn AI vs DreamGF":
    https://aicompanionpicker.com/comparisons/crushon-ai-vs-dreamgf/
17. FindAIChat, "DreamGF vs Muah AI":
    https://findaichat.com/compare/dreamgf-ai-vs-muah-ai
18. OpenRouter, Sao10K Llama 3.3 Euryale 70B model page (pricing and latency):
    https://openrouter.ai/sao10k/l3.3-euryale-70b
19. AtlasCloud, "20 Uncensored AI Models 2026 Ranked by Real Usage":
    https://www.atlascloud.ai/blog/guides/best-uncensored-ai-models
20. Featherless model directory (Anubis 70B, Huihui abliterated tier, DeepSeek V4):
    https://featherless.ai/
21. UncensoredHub, "Magnum v4 22B" (24 GB-class default rationale):
    https://uncensoredhub.ai/learn/magnum-v4-22b
22. LLMIndex, "TheDrummer: Cydonia 24B V4.1":
    https://llmindex.net/models/cydonia-24b-v4-1
23. Venice / dphn, "Venice-Role-Play-Uncensored-GGUF" (Dolphin Mistral 24B Venice Edition):
    https://huggingface.co/dphn/Venice-Role-Play-Uncensored-GGUF
    OpenRouter venice hub: https://openrouter.ai/venice
24. AIPornGuide, "Janitor AI Review 2026" (BYOK sweet spot: DeepSeek V3, MythoMax):
    https://aipornguide.com/blog/janitor-ai-review/

## 9. Cross-reference

- `Plans/llm-list.md`: superset of open-weight candidates, most 70B+ options
  there are OpenRouter/Featherless-only for us given the 24 GB box.
- `Plans/prds/master-prd.md`: latency SLOs (first-token < 1 s p50, < 2 s p95),
  chat quality bar.
- `Plans/model-hosting-aws-cost-analysis.md`: co-location realities on the
  A10G, Juggernaut VRAM peaks, system-RAM ceiling.
- `backend/src/llm/constants.ts` and `backend/src/llm/provider.ts`: routing
  chain, `POPPY_CHAT_MODEL` env selector, circuit-breaker semantics, fast-fail
  timeout.
