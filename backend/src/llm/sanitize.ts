// Reasoning-leak stripper. Two surfaces:
//   1. stripThinkingBlocks(text) ,  final-pass strip for the completed reply.
//      Removes tagged reasoning (<think>, <reasoning>, [thinking]),
//      preambles ("Okay, the user..."), and third-person meta-commentary.
//   2. StreamGuard ,  incremental filter for the token stream. Buffers when a
//      partial "<" could be the start of a reasoning tag; only flushes bytes
//      that are guaranteed to be safe to render. Ensures a partial "<think"
//      never reaches the client mid-stream.
//
// Ported from ../Pellow/backend/src/llm/client.ts.

// ============================================================================
// Final pass
// ============================================================================

const TAG_BLOCKS: RegExp[] = [
  /<think>[\s\S]*?<\/think>/gi,
  /<reasoning>[\s\S]*?<\/reasoning>/gi,
  /\[thinking\][\s\S]*?\[\/thinking\]/gi,
];

const PREAMBLES: RegExp[] = [
  /^(?:Okay|Ok|Alright|Right|So|Hmm|Well),?\s+(?:the user|let me|I need|I should|first|so |looking|this )[\s\S]*?\n\n/i,
  /^(?:Let me|I'll|I need to|I should|First,? I)[\s\S]*?\n\n/i,
];

const META_PATTERNS: RegExp[] = [
  /^(?:The user|User (?:is|has|was|said|just|seems|mentioned|confirmed))/i,
  /^(?:They(?:'re| are| were| have| said| mentioned| talked| just| seem))\s/i,
  /^(?:This (?:aligns|is a|seems|indicates|suggests|means|shows))/i,
  /^(?:Looking at|Analyzing|Considering|Based on|Given that|From (?:the|their))/i,
  /^(?:Important:|Key constraints:|Note:|Context:|Background:)/i,
  /^(?:My response should|I should respond|I need to|The (?:right|best) (?:move|approach))/i,
  /^(?:Also noting|Also important|Noting that|I notice)/i,
];

export function isMetaCommentary(text: string): boolean {
  const firstLine = text.split("\n")[0].trim();
  return META_PATTERNS.some((p) => p.test(firstLine));
}

export function stripThinkingBlocks(text: string): string {
  let result = text;

  // 1. Tagged reasoning blocks.
  for (const re of TAG_BLOCKS) result = result.replace(re, "").trim();

  // 2. Unclosed <think>: drop from the open tag onward.
  const openThink = result.indexOf("<think>");
  if (openThink !== -1 && result.indexOf("</think>", openThink) === -1) {
    result = result.slice(0, openThink).trim();
  }

  // 3. Reasoning preambles.
  for (const re of PREAMBLES) {
    const m = result.match(re);
    if (m) result = result.slice(m[0].length).trim();
  }

  // 4. Meta-commentary paragraphs. Peel from the top until the first
  //    paragraph reads like direct speech.
  while (result.length > 0 && isMetaCommentary(result)) {
    const next = result.indexOf("\n\n");
    if (next > 0 && next < result.length - 10) {
      result = result.slice(next + 2).trim();
    } else {
      break;
    }
  }

  return result;
}

// ============================================================================
// Streaming guard
// ============================================================================

// Longest prefix we need to hold back to disambiguate a tag. Chosen to cover
// "[thinking]" (10 chars) plus a bit of slack.
const MAX_HOLDBACK = 16;
const TAG_STARTS = ["<think>", "<reasoning>", "[thinking]"];

// StreamGuard consumes deltas and yields whatever is safe to forward RIGHT
// NOW. When a partial that could still become a tag opener sits at the tail
// of the buffer, we hold it back until the next delta resolves it.
//
// If a tag opener is confirmed, we swallow bytes until the matching closing
// tag arrives. If the stream ends mid-tag we drop the incomplete tag entirely.
export class StreamGuard {
  private buf = "";
  private mode: "text" | "inside_tag" = "text";
  private closeTag = "";

  push(delta: string): string {
    this.buf += delta;
    return this.drain(false);
  }

  end(): string {
    // Flush what's safe; drop anything still inside a tag or looking like a
    // partial tag opener.
    const trailing = this.drain(true);
    if (this.mode === "inside_tag") {
      // The stream ended mid-tag. Suppress everything we still hold.
      this.buf = "";
      return trailing;
    }
    // Emit whatever is left; there is no future delta that could turn it into
    // a tag opener.
    const rest = this.buf;
    this.buf = "";
    return trailing + rest;
  }

  private drain(finalPass: boolean): string {
    let out = "";
    while (this.buf.length > 0) {
      if (this.mode === "inside_tag") {
        const idx = this.buf.indexOf(this.closeTag);
        if (idx === -1) {
          // Wait for more deltas.
          this.buf = "";
          return out;
        }
        this.buf = this.buf.slice(idx + this.closeTag.length);
        this.mode = "text";
        this.closeTag = "";
        continue;
      }

      // Look for a full tag opener OR a partial-suffix that could still become
      // one. If we find a full opener at position N, everything before N is
      // safe to emit and we switch to inside_tag mode.
      const firstOpener = this.findFirstOpener();
      if (firstOpener !== null) {
        out += this.buf.slice(0, firstOpener.index);
        this.buf = this.buf.slice(firstOpener.index + firstOpener.opener.length);
        this.mode = "inside_tag";
        this.closeTag = openerToCloser(firstOpener.opener);
        continue;
      }

      // No full opener. Only hold back the trailing bytes that are a strict
      // prefix of a known opener; anything before that is safe to forward.
      const holdIdx = this.trailingPrefixIndex();
      if (holdIdx === -1) {
        out += this.buf;
        this.buf = "";
        return out;
      }
      if (finalPass) {
        // Stream is ending; a partial opener will never resolve, so emit
        // whatever precedes it and drop the partial.
        out += this.buf.slice(0, holdIdx);
        this.buf = "";
        return out;
      }
      out += this.buf.slice(0, holdIdx);
      this.buf = this.buf.slice(holdIdx);
      return out;
    }
    return out;
  }

  private findFirstOpener(): { index: number; opener: string } | null {
    let best: { index: number; opener: string } | null = null;
    for (const opener of TAG_STARTS) {
      const idx = this.buf.toLowerCase().indexOf(opener);
      if (idx !== -1 && (best === null || idx < best.index)) {
        best = { index: idx, opener };
      }
    }
    return best;
  }

  // Index of the earliest position in the buffer that starts a strict prefix
  // of any known opener. Returns -1 if no such prefix exists in the last
  // MAX_HOLDBACK bytes.
  private trailingPrefixIndex(): number {
    const start = Math.max(0, this.buf.length - MAX_HOLDBACK);
    for (let i = start; i < this.buf.length; i++) {
      const tail = this.buf.slice(i).toLowerCase();
      for (const opener of TAG_STARTS) {
        if (opener.startsWith(tail) && tail.length < opener.length) {
          return i;
        }
      }
    }
    return -1;
  }
}

function openerToCloser(opener: string): string {
  switch (opener.toLowerCase()) {
    case "<think>":
      return "</think>";
    case "<reasoning>":
      return "</reasoning>";
    case "[thinking]":
      return "[/thinking]";
    default:
      return opener;
  }
}
