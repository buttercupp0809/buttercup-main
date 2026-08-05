// Streaming-safe gesture parser. Pure, framework-free, O(n).
//
// Contract (see Phase 19 plan):
//   - `\*` is a literal asterisk, never a delimiter.
//   - A `*` opens a gesture; the next unescaped `*` closes it. Content
//     between them becomes a `gesture` segment (inner whitespace preserved).
//   - `**` collapses to nothing (no empty span).
//   - Flat model: an inner `*` inside an open gesture closes it. No nesting.
//   - A trailing UNMATCHED `*` and everything after it renders as a plain
//     `text` segment. This is the flicker-free contract for streaming:
//     "*she smil" -> plain text, and only flips to italic when the closing
//     "*" arrives.
//   - Adjacent `text` segments are merged so the output is minimal.

export type Segment =
  | { kind: "text"; value: string }
  | { kind: "gesture"; value: string };

export function parseGestures(input: string): Segment[] {
  const out: Segment[] = [];
  let buf = "";
  let i = 0;
  const flushText = () => {
    if (buf.length > 0) {
      out.push({ kind: "text", value: buf });
      buf = "";
    }
  };

  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\" && input[i + 1] === "*") {
      // Escaped asterisk: literal, never a delimiter.
      buf += "*";
      i += 2;
      continue;
    }
    if (ch === "*") {
      // Look ahead for the closing `*`, skipping escaped `\*`.
      let j = i + 1;
      let closer = -1;
      while (j < input.length) {
        if (input[j] === "\\" && input[j + 1] === "*") {
          j += 2;
          continue;
        }
        if (input[j] === "*") {
          closer = j;
          break;
        }
        j += 1;
      }
      if (closer === -1) {
        // No closer yet: render the tail plainly so streaming does not
        // flicker italic on/off. Emit prior buffer + the raw tail as one
        // merged plain segment.
        buf += input.slice(i);
        i = input.length;
        break;
      }
      // We have a matched pair [i, closer]. Extract inner and unescape any
      // `\*` inside it so the rendered gesture reads literally.
      const rawInner = input.slice(i + 1, closer);
      const inner = rawInner.replace(/\\\*/g, "*");
      flushText();
      if (inner.length > 0) {
        out.push({ kind: "gesture", value: inner });
      }
      // `**` collapses to nothing; nothing to push.
      i = closer + 1;
      continue;
    }
    buf += ch;
    i += 1;
  }

  flushText();
  return mergeAdjacentText(out);
}

function mergeAdjacentText(segments: Segment[]): Segment[] {
  const merged: Segment[] = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (s.kind === "text" && last && last.kind === "text") {
      last.value += s.value;
    } else {
      merged.push(s);
    }
  }
  return merged;
}
