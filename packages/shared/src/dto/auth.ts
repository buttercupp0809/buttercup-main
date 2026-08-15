// Auth + age-gate DTOs. Every /api route in Phase 01 parses input with one of
// these before touching Prisma. Server side, we recompute age from dob so the
// client cannot spoof it.

import { z } from "zod";

export const MIN_AGE_YEARS = 18;

// Full years between dob and now, computed server-side. Handles leap years
// correctly for edge cases like a Feb 29 birthday.
export function computeAgeYears(dob: Date, now: Date = new Date()): number {
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthdayThisYear =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthdayThisYear) years -= 1;
  return years;
}

const emailField = z.string().trim().toLowerCase().email().max(320);

// Single source of truth for the SIGNUP password rule. Both the client
// (live checklist + strength bar in frontend/components/auth/PasswordChecklist)
// and the server route validators MUST use this list; do not duplicate the
// regexes in the UI. The frontend imports PASSWORD_RULES / passwordChecklist
// directly, so any change here is reflected in the checklist automatically.
export const PASSWORD_MIN = 12;

export interface PasswordRule {
  id: "min" | "upper" | "lower" | "digit" | "symbol";
  label: string;
  test: (s: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: "min", label: `At least ${PASSWORD_MIN} characters`, test: (s) => s.length >= PASSWORD_MIN },
  { id: "upper", label: "One uppercase letter", test: (s) => /[A-Z]/.test(s) },
  { id: "lower", label: "One lowercase letter", test: (s) => /[a-z]/.test(s) },
  { id: "digit", label: "One digit", test: (s) => /\d/.test(s) },
  { id: "symbol", label: "One symbol", test: (s) => /[^A-Za-z0-9]/.test(s) },
];

export interface PasswordCheckResult {
  id: PasswordRule["id"];
  label: string;
  ok: boolean;
}

export function passwordChecklist(input: string): PasswordCheckResult[] {
  return PASSWORD_RULES.map((r) => ({ id: r.id, label: r.label, ok: r.test(input) }));
}

// SIGNUP passwordField: strong rule (min 12 + upper + lower + digit + symbol).
// Every failing rule is surfaced as its own issue so the client-side checklist
// and the server response line up. New accounts pay the strong-rule cost.
const passwordField = z
  .string()
  .max(200)
  .superRefine((val, ctx) => {
    for (const rule of PASSWORD_RULES) {
      if (!rule.test(val)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: rule.label,
          params: { rule: rule.id },
        });
      }
    }
  });

// LOGIN passwordField: INTENTIONALLY lenient. Users created before the
// strong-rule upgrade have passwords that would fail the new rule, and
// bcrypt is a one-way hash so we cannot re-check strength on login. Enforcing
// PASSWORD_RULES here would lock out every legacy account. Password strength
// is enforced at signup and (future) at password-reset only.
const loginPasswordField = z.string().min(1).max(200);

const dobField = z.coerce
  .date()
  .refine((d) => !Number.isNaN(d.getTime()), { message: "invalid dob" })
  .refine((d) => d.getUTCFullYear() >= 1900, { message: "dob out of range" })
  .refine((d) => d <= new Date(), { message: "dob cannot be in the future" });

// ISO 3166-1 alpha-2 country code. Region-level policy (e.g. US-CA vs US-TX)
// happens in the jurisdiction policy module, not the DTO.
const jurisdictionField = z
  .string()
  .trim()
  .length(2, "jurisdiction must be a 2-letter ISO country code")
  .transform((s) => s.toUpperCase());

const acceptedTrue = z.literal(true, {
  errorMap: () => ({ message: "must be accepted" }),
});

export const SignupDto = z
  .object({
    email: emailField,
    password: passwordField,
    dob: dobField,
    jurisdiction: jurisdictionField,
    tosAccepted: acceptedTrue,
    privacyAccepted: acceptedTrue,
  })
  .refine((v) => computeAgeYears(v.dob) >= MIN_AGE_YEARS, {
    path: ["dob"],
    message: `must be at least ${MIN_AGE_YEARS}`,
  });
export type SignupInput = z.infer<typeof SignupDto>;

export const LoginDto = z.object({
  email: emailField,
  password: loginPasswordField,
});
export type LoginInput = z.infer<typeof LoginDto>;

export const MagicLinkRequestDto = z.object({ email: emailField });
export type MagicLinkRequestInput = z.infer<typeof MagicLinkRequestDto>;

// Password reset. Requesting a link only needs the email; consuming a link
// enforces the SAME strong password rule as signup (see the note above).
export const ForgotPasswordDto = z.object({ email: emailField });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordDto>;

export const ResetPasswordDto = z.object({
  token: z.string().min(10).max(4096),
  password: passwordField,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordDto>;

export const AgeGateDto = z
  .object({
    dob: dobField,
    jurisdiction: jurisdictionField,
    tosAccepted: acceptedTrue,
    privacyAccepted: acceptedTrue,
  })
  .refine((v) => computeAgeYears(v.dob) >= MIN_AGE_YEARS, {
    path: ["dob"],
    message: `must be at least ${MIN_AGE_YEARS}`,
  });
export type AgeGateInput = z.infer<typeof AgeGateDto>;

// Google OAuth GIS ID-token payload sent by the browser after the user picks
// a Google account. We verify the token with Google's certs on the server.
export const GoogleOAuthDto = z.object({
  idToken: z.string().min(20).max(4096),
});
export type GoogleOAuthInput = z.infer<typeof GoogleOAuthDto>;
