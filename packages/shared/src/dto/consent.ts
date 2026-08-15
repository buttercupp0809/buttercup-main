// Phase 29: first-login consent gate DTO. The accept route is the single
// consent-recording choke point; z.literal(true) on each box means a request
// with any box unchecked fails validation at the trust boundary, not just in
// the client UI.

import { z } from "zod";

const acceptedTrue = z.literal(true, {
  errorMap: () => ({ message: "must be accepted" }),
});

export const ConsentAcceptDto = z.object({
  policyVersion: z.string().min(1),
  tosAccepted: acceptedTrue,
  privacyAccepted: acceptedTrue,
  ageConfirmed: acceptedTrue,
});
export type ConsentAcceptInput = z.infer<typeof ConsentAcceptDto>;
