# TLS-RPT Policy Discriminated Union Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single `TLSReport` policy interface (with optional fields and embedded Google workaround) with a discriminated union that models both RFC 8460 and Google's non-standard nested format as first-class types, with normalization at the parse boundary.

**Architecture:** Define `RFCPolicy` (fields at top level, all required) and `GooglePolicy` (fields inside a `policy` sub-object) as separate types. `parseTLSReport` normalizes `RawTLSPolicy[]` → `RFCPolicy[]` before returning. Downstream code (`storage.ts`) receives only `RFCPolicy` entries where `policy-type` and `policy-domain` are required strings — the runtime skip guard is no longer needed.

**Tech Stack:** TypeScript, Cloudflare Workers D1, vitest, oxlint, oxfmt

---

### Task 1: Define discriminated union types in `src/types.ts`

**Files:**

- Modify: `src/types.ts`

**Step 1: Replace the `TLSReport.policies` array type**

Replace the current `TLSReport` interface's `policies` field and add the supporting types:

```typescript
export type PolicyType = "sts" | "dane" | "dane-only" | "no-policy-found";

export interface TLSFailureDetail {
  "result-type": string;
  "sending-mta-ip": string;
  "receiving-mx-hostname": string;
  "failed-session-count": number;
}

export interface TLSPolicySummary {
  "total-successful-session-count": number;
  "total-failure-session-count": number;
}

// RFC 8460 §5.2: policy-type and policy-domain at top level
export interface RFCPolicy {
  "policy-type": PolicyType;
  "policy-domain": string;
  "summary": TLSPolicySummary;
  "failure-details"?: TLSFailureDetail[];
}

// Google's non-standard format: policy fields nested under "policy"
export interface GooglePolicy {
  "policy": {
    "policy-type": PolicyType;
    "policy-domain": string;
  };
  "summary": TLSPolicySummary;
  "failure-details"?: TLSFailureDetail[];
}

export type RawTLSPolicy = RFCPolicy | GooglePolicy;
```

Update `TLSReport`:

```typescript
export interface TLSReport {
  "organization-name": string;
  "date-range": {
    "start-datetime": string;
    "end-datetime": string;
  };
  "contact-info": string;
  "report-id": string;
  "policies"?: RawTLSPolicy[];
}
```

**Step 2: Run type-check**

```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS"
```

Expected: errors in `tlsrpt.ts` and `storage.ts` (they reference old types — fix in next tasks).

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "refactor(tlsrpt): define discriminated union for RFC vs Google policy format"
```

---

### Task 2: Update `src/tlsrpt.ts` — normalize at parse boundary

**Files:**

- Modify: `src/tlsrpt.ts`

**Step 1: Add a type guard for `GooglePolicy`**

Add this after the imports:

```typescript
import type { RFCPolicy, GooglePolicy, RawTLSPolicy, TLSReport } from "./types";

function isGooglePolicy(p: RawTLSPolicy): p is GooglePolicy {
  return "policy" in p && typeof p.policy === "object" && p.policy !== null;
}
```

**Step 2: Rewrite `normalizePolicies` with proper types**

```typescript
function normalizePolicies(policies: RawTLSPolicy[]): RFCPolicy[] {
  return policies.flatMap((entry): RFCPolicy[] => {
    if (isGooglePolicy(entry)) {
      return [
        {
          "policy-type": entry.policy["policy-type"],
          "policy-domain": entry.policy["policy-domain"],
          "summary": entry.summary,
          "failure-details": entry["failure-details"],
        },
      ];
    }
    return [
      {
        "policy-type": entry["policy-type"],
        "policy-domain": entry["policy-domain"],
        "summary": entry.summary,
        "failure-details": entry["failure-details"],
      },
    ];
  });
}
```

**Step 3: Update `parseTLSReport` return signature**

`parseTLSReport` returns `TLSReport` but now `TLSReport.policies` is `RawTLSPolicy[]`. After parsing, normalize and return a `TLSReport` with `policies` replaced by `RFCPolicy[]`. To do this cleanly, define a normalized report type or just replace the policies field:

```typescript
export function parseTLSReport(
  content: string,
): (Omit<TLSReport, "policies"> & { policies?: RFCPolicy[] }) | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (isTLSReport(parsed)) {
      return {
        ...parsed,
        policies: parsed.policies ? normalizePolicies(parsed.policies) : undefined,
      };
    }
    console.error("Invalid TLS-RPT structure");
    return null;
  } catch (error) {
    console.error("Failed to parse TLS-RPT JSON:", error);
    return null;
  }
}
```

Alternatively (simpler): export a `NormalizedTLSReport` type alias:

```typescript
export type NormalizedTLSReport = Omit<TLSReport, "policies"> & { policies?: RFCPolicy[] };
```

Add this to `types.ts` and use it as the return type of `parseTLSReport`.

**Step 4: Update inline vitest fixtures**

In the `import.meta.vitest` block, the `VALID_TLS_REPORT` fixture uses flat RFC format — no change needed. The `normalizePolicies` change means `report.policies?.[0]["policy-type"]` is now required (not optional) — remove `?.` where appropriate.

**Step 5: Run type-check**

```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS"
```

Expected: only `storage.ts` errors remain.

**Step 6: Commit**

```bash
git add src/tlsrpt.ts src/types.ts
git commit -m "refactor(tlsrpt): normalize RawTLSPolicy to RFCPolicy at parse boundary"
```

---

### Task 3: Update `src/storage.ts` — remove skip guard, tighten bindings

**Files:**

- Modify: `src/storage.ts`

**Step 1: Update the import and `storeTLSReport` signature**

`storeTLSReport` currently takes `TLSReport`. After the refactor, `parseTLSReport` returns `NormalizedTLSReport`. Update the import and signature:

```typescript
import type { DMARCReport, Env, NormalizedTLSReport } from "./types";

export async function storeTLSReport(report: NormalizedTLSReport, env: Pick<Env, "DB">): Promise<void> {
```

**Step 2: Remove the skip guard — it's no longer needed**

Delete these lines:

```typescript
if (policy["policy-domain"] === undefined || policy["policy-domain"] === "") {
  console.warn("TLS-RPT policy missing policy-domain, skipping");
  continue;
}
```

**Step 3: Remove `?? null` fallbacks for required fields**

`policy-domain` and `policy-type` are now required in `RFCPolicy`. Remove the `?? null` guards:

```typescript
.bind(
  report["report-id"],
  report["organization-name"],
  policy["policy-domain"],   // was: ?? null
  policy["policy-type"],     // was: ?? null
  policy.summary["total-successful-session-count"],
  policy.summary["total-failure-session-count"],
  JSON.stringify(policy["failure-details"] ?? []),
  new Date(report["date-range"]["start-datetime"]).getTime() / 1000,
  new Date(report["date-range"]["end-datetime"]).getTime() / 1000,
)
```

**Step 4: Run type-check and linter**

```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS"
pnpm exec oxlint --type-aware 2>&1 | tail -3
```

Expected: 0 errors, 0 warnings.

**Step 5: Commit**

```bash
git add src/storage.ts
git commit -m "refactor(storage): remove policy-domain skip guard — guaranteed by RFCPolicy type"
```

---

### Task 4: Update `src/__tests__/storage.test.ts`

**Files:**

- Modify: `src/__tests__/storage.test.ts`

**Step 1: Update the import**

```typescript
import type { NormalizedTLSReport } from "../types";
```

Replace `TLSReport` with `NormalizedTLSReport` in the test fixture type annotations.

**Step 2: Run the tests**

```bash
pnpm test
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add src/__tests__/storage.test.ts
git commit -m "test(tlsrpt): update storage tests to use NormalizedTLSReport"
```

---

### Task 5: Update callers in `src/index.ts`

**Files:**

- Modify: `src/index.ts`

**Step 1: Check that `parseTLSReport` return type flows correctly**

`parseTLSReport` now returns `NormalizedTLSReport | null`. The call site in `index.ts` passes the result to `storeTLSReport`. Verify the types align — no code change may be needed.

```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS"
```

**Step 2: Final lint + format check**

```bash
pnpm exec oxlint --type-aware 2>&1 | tail -3
pnpm exec oxfmt --check src/
```

Expected: 0 warnings, 0 errors, no format issues.

**Step 3: Run all tests**

```bash
pnpm test
```

Expected: all pass.

**Step 4: Final commit if any changes**

```bash
git add src/index.ts
git commit -m "chore(tlsrpt): align index.ts with NormalizedTLSReport type"
```
