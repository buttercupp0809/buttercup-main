// PoppyFaceSwap (inswapper_128 + GPEN restore). When gpenVisibility is provided
// (Fix 1 lowers it to ~0.6), it is emitted as an input; when omitted the node is
// byte-identical to the current graph (target_image + source_image only), so an
// all-flags-off assembly does not change today's behavior or require any box-side
// node change.
export function faceSwapNode(a: {
  targetRef: [string, number];
  gpenVisibility?: number;
}): Record<string, unknown> {
  const inputs: Record<string, unknown> = {
    target_image: a.targetRef,
    source_image: ["10", 0],
  };
  if (typeof a.gpenVisibility === "number") {
    inputs.gpen_visibility = a.gpenVisibility;
  }
  return { "50": { class_type: "PoppyFaceSwap", inputs } };
}
