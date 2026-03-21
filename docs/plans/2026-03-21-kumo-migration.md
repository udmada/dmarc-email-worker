# Kumo Design System Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace DaisyUI with Cloudflare's Kumo component library (`@cloudflare/kumo`) across all Astro UI pages, maintaining zero client-side JavaScript.

**Architecture:** Kumo React components render server-side in `.astro` files without any `client:*` directive — static HTML only, no hydration. `@astrojs/react` integration handles the server-side JSX transform. Kumo's CSS (`@cloudflare/kumo/styles`) provides semantic design tokens (`text-kumo-default`, `bg-kumo-surface`, etc.) via Tailwind v4 `@theme` blocks. Dark mode follows `prefers-color-scheme` automatically via CSS `light-dark()` — no `data-theme` attribute needed.

**Tech Stack:** `@cloudflare/kumo` v1.15.0, `@astrojs/react`, React 19, Tailwind v4, Astro 5 SSR.

---

## Context

- Worktree: `.worktrees/feature/astro-ui` (branch `feature/astro-ui`)
- All `ui/` paths are relative to the worktree root
- Package manager: `pnpm` (workspace root)
- Current state: DaisyUI + Tailwind v4, all pages complete and passing `pnpm check`
- No tests for the UI package (verify via `pnpm check` + `pnpm build`)

## Component Mapping Reference

| DaisyUI                             | Kumo                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| `<div class="badge badge-error">`   | `<Badge variant="destructive">`                                  |
| `<div class="badge badge-success">` | `<Badge variant="success">`                                      |
| `<div class="badge badge-warning">` | `<Badge variant="outline">`                                      |
| `<div class="badge badge-ghost">`   | `<Badge variant="secondary">`                                    |
| `<div class="card bg-base-200">`    | `<Surface>`                                                      |
| `<table class="table table-zebra">` | `<Table>` compound                                               |
| `<button class="btn btn-primary">`  | `<Button variant="primary">`                                     |
| `<button class="btn btn-ghost">`    | `<Button variant="ghost">`                                       |
| `<a class="btn btn-ghost">`         | `<a className="...kumo tokens...">` or `<Button render={<a />}>` |
| `bg-base-100` (page bg)             | `bg-kumo-surface`                                                |
| `bg-base-200` (card/sidebar bg)     | `bg-kumo-recessed`                                               |
| `text-base-content`                 | `text-kumo-default`                                              |
| `text-base-content/60`              | `text-kumo-subtle`                                               |
| `text-base-content/40`              | `text-kumo-inactive`                                             |
| `border-base-300`                   | `border-kumo-line`                                               |
| `text-success`                      | `text-kumo-success`                                              |
| `text-error`                        | `text-kumo-danger`                                               |
| `text-primary`                      | `text-kumo-brand`                                                |

## Policy Badge Convention

```tsx
// DMARC policy_p field:
// "reject"     → <Badge variant="destructive">
// "quarantine" → <Badge variant="outline">
// "none"       → <Badge variant="secondary">
```

## Kumo Table Pattern (for all data tables)

```tsx
import { Table } from "@cloudflare/kumo";

<Table>
  <Table.Header>
    <Table.Row>
      <Table.Head>Column A</Table.Head>
      <Table.Head>Column B</Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {rows.map((r) => (
      <Table.Row key={r.id}>
        <Table.Cell>{r.field_a}</Table.Cell>
        <Table.Cell>{r.field_b}</Table.Cell>
      </Table.Row>
    ))}
    {rows.length === 0 && (
      <Table.Row>
        <Table.Cell colSpan={2} className="text-center py-8 text-kumo-inactive">
          No data found.
        </Table.Cell>
      </Table.Row>
    )}
  </Table.Body>
</Table>;
```

## Kumo Surface Pattern (for cards)

```tsx
import { Surface } from "@cloudflare/kumo";

<Surface className="p-6">content</Surface>;
```

## Pagination (keep URL-based, no Kumo Pagination component)

Kumo's `Pagination` requires a `setPage` state callback — incompatible with URL-based SSR navigation. Keep the existing custom pagination with Kumo token classes:

```astro
{pages > 1 && (
  <div class="flex justify-center mt-6 gap-1">
    {page > 1 && (
      <a href={pageUrl(page - 1)} class="inline-flex items-center px-3 py-1.5 text-sm rounded-md border border-kumo-line text-kumo-default hover:bg-kumo-recessed transition-colors">
        <span aria-hidden="true">←</span> Prev
      </a>
    )}
    {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
      <a
        href={pageUrl(p)}
        class={`inline-flex items-center px-3 py-1.5 text-sm rounded-md transition-colors ${
          p === page
            ? "bg-kumo-contrast text-kumo-inverse"
            : "border border-kumo-line text-kumo-default hover:bg-kumo-recessed"
        }`}
      >{p}</a>
    ))}
    {page < pages && (
      <a href={pageUrl(page + 1)} class="inline-flex items-center px-3 py-1.5 text-sm rounded-md border border-kumo-line text-kumo-default hover:bg-kumo-recessed transition-colors">
        Next <span aria-hidden="true">→</span>
      </a>
    )}
  </div>
)}
```

## Filter Form Inputs (keep native HTML)

Kumo's `Input` is a controlled React component — not suitable for a plain HTML `method="get"` form. Use native `<input>` with Kumo token classes:

```astro
<input
  type="text"
  name="domain"
  value={domain ?? ""}
  placeholder="Filter by domain…"
  class="h-8 px-3 text-sm rounded-md border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-placeholder focus:outline-2 focus:outline-kumo-brand w-48"
/>
```

---

## Task 1: Install Kumo and configure React integration

**Files:**

- Modify: `ui/package.json`
- Modify: `ui/astro.config.mjs`
- Modify: `ui/src/styles/global.css`

**Step 1: Install dependencies**

```bash
cd /path/to/worktree/ui
pnpm add @cloudflare/kumo react react-dom
pnpm add -D @astrojs/react @types/react @types/react-dom
```

**Step 2: Add React integration to `ui/astro.config.mjs`**

```js
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
```

**Step 3: Update `ui/src/styles/global.css`**

Replace DaisyUI plugin with Kumo styles:

```css
@import "tailwindcss";
@import "@cloudflare/kumo/styles";
```

**Step 4: Verify build**

```bash
cd /path/to/worktree/ui
pnpm check
pnpm build
```

Expected: 0 errors, build succeeds, `dist/_worker.js` produced.

If `pnpm check` fails with type errors about React JSX, add to `ui/tsconfig.json` `compilerOptions`:

```json
"jsx": "react-jsx",
"jsxImportSource": "react"
```

**Step 5: Commit**

```bash
git add ui/package.json ui/astro.config.mjs ui/src/styles/global.css ui/tsconfig.json pnpm-lock.yaml
git commit -m "feat(ui): install Kumo and add React integration"
```

---

## Task 2: Update Layout and Sidebar

**Files:**

- Modify: `ui/src/components/Layout.astro`
- Modify: `ui/src/components/Sidebar.astro`

**Step 1: Rewrite `ui/src/components/Layout.astro`**

Remove `data-theme="dark"`. Replace DaisyUI token classes with Kumo tokens:

```astro
---
import { ViewTransitions } from "astro:transitions";
import Sidebar from "./Sidebar.astro";
import "../styles/global.css";

interface Props { title: string; }
const { title } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title} — DMARC Viewer</title>
    <ViewTransitions />
  </head>
  <body class="bg-kumo-surface text-kumo-default">
    <div class="flex min-h-screen">
      <Sidebar />
      <main class="flex-1 p-8 overflow-auto">
        <slot />
      </main>
    </div>
  </body>
</html>
```

**Step 2: Rewrite `ui/src/components/Sidebar.astro`**

Use Kumo token classes for the sidebar. No Kumo component for Sidebar exists — use `<nav>` with token classes:

```astro
---
const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dmarc-reports", label: "DMARC Reports" },
  { href: "/tls-reports", label: "TLS Reports" },
];
const current = Astro.url.pathname;
---
<aside class="w-56 min-h-screen bg-kumo-recessed border-r border-kumo-line flex flex-col">
  <div class="p-4 border-b border-kumo-line">
    <span class="font-semibold text-base text-kumo-default tracking-tight">DMARC Viewer</span>
  </div>
  <nav class="flex-1 p-3 flex flex-col gap-1">
    {links.map((link) => (
      <a
        href={link.href}
        class:list={[
          "flex items-center px-3 py-2 rounded-md text-sm transition-colors",
          current.startsWith(link.href)
            ? "bg-kumo-tint text-kumo-default font-medium"
            : "text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default",
        ]}
      >
        {link.label}
      </a>
    ))}
  </nav>
</aside>
```

**Step 3: Verify**

```bash
cd /path/to/worktree/ui && pnpm check
```

Expected: 0 errors.

**Step 4: Commit**

```bash
git add ui/src/components/
git commit -m "feat(ui): migrate Layout and Sidebar to Kumo tokens"
```

---

## Task 3: Update Dashboard page

**Files:**

- Modify: `ui/src/pages/dashboard.astro`

**Step 1: Rewrite `ui/src/pages/dashboard.astro`**

```astro
---
import { Badge, Surface, Table } from "@cloudflare/kumo";
import Layout from "../components/Layout.astro";
import { getDashboardStats, getRecentDmarcReports, formatDate } from "../lib/db";

const db = Astro.locals.runtime.env.DB;
const [stats, recent] = await Promise.all([
  getDashboardStats(db),
  getRecentDmarcReports(db, 10),
]);
---

<Layout title="Dashboard">
  <div class="mb-6">
    <h1 class="text-2xl font-semibold text-kumo-default">Overview</h1>
    <p class="text-sm text-kumo-subtle mt-1">DMARC & TLS-RPT report summary</p>
  </div>

  <!-- Stat cards -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
    <Surface className="p-5">
      <p class="text-xs text-kumo-subtle uppercase tracking-wide">DMARC Reports</p>
      <p class="text-3xl font-bold text-kumo-brand mt-1">{stats.dmarcThisMonth}</p>
      <p class="text-xs text-kumo-inactive mt-1">this month</p>
    </Surface>
    <Surface className="p-5">
      <p class="text-xs text-kumo-subtle uppercase tracking-wide">TLS Reports</p>
      <p class="text-3xl font-bold text-kumo-link mt-1">{stats.tlsThisMonth}</p>
      <p class="text-xs text-kumo-inactive mt-1">this month</p>
    </Surface>
    <Surface className="p-5">
      <p class="text-xs text-kumo-subtle uppercase tracking-wide">DKIM Pass Rate</p>
      <p class="text-3xl font-bold text-kumo-success mt-1">{stats.dkimPassRate}%</p>
      <p class="text-xs text-kumo-inactive mt-1">all time</p>
    </Surface>
    <Surface className="p-5">
      <p class="text-xs text-kumo-subtle uppercase tracking-wide">SPF Pass Rate</p>
      <p class="text-3xl font-bold text-kumo-success mt-1">{stats.spfPassRate}%</p>
      <p class="text-xs text-kumo-inactive mt-1">all time</p>
    </Surface>
  </div>

  <!-- Recent activity -->
  <Surface>
    <div class="flex items-center justify-between px-6 py-4 border-b border-kumo-line">
      <h2 class="font-semibold text-kumo-default">Recent DMARC Reports</h2>
      <a href="/dmarc-reports" class="text-sm text-kumo-link hover:text-kumo-link/70 transition-colors">
        View all <span aria-hidden="true">→</span>
      </a>
    </div>
    <div class="overflow-x-auto">
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.Head>Domain</Table.Head>
            <Table.Head>Org</Table.Head>
            <Table.Head>Date</Table.Head>
            <Table.Head>Policy</Table.Head>
            <Table.Head className="sr-only">Actions</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {recent.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={5} className="text-center py-8 text-kumo-inactive">
                No reports yet.
              </Table.Cell>
            </Table.Row>
          ) : (
            recent.map((r) => (
              <Table.Row key={r.report_id}>
                <Table.Cell className="font-mono text-sm">{r.domain}</Table.Cell>
                <Table.Cell className="text-kumo-subtle">{r.org_name}</Table.Cell>
                <Table.Cell className="text-kumo-subtle">{formatDate(r.begin_date)}</Table.Cell>
                <Table.Cell>
                  <Badge
                    variant={
                      r.policy_p === "reject"
                        ? "destructive"
                        : r.policy_p === "quarantine"
                          ? "outline"
                          : "secondary"
                    }
                  >
                    {r.policy_p}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <a
                    href={`/dmarc-reports/${r.report_id}`}
                    class="text-sm text-kumo-link hover:text-kumo-link/70 transition-colors"
                  >
                    View <span aria-hidden="true">→</span>
                  </a>
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>
    </div>
  </Surface>
</Layout>
```

**Step 2: Verify**

```bash
cd /path/to/worktree/ui && pnpm check
```

Expected: 0 errors.

**Step 3: Commit**

```bash
git add ui/src/pages/dashboard.astro
git commit -m "feat(ui): migrate dashboard to Kumo components"
```

---

## Task 4: Update DMARC Reports list page

**Files:**

- Modify: `ui/src/pages/dmarc-reports.astro`

**Step 1: Rewrite `ui/src/pages/dmarc-reports.astro`**

```astro
---
import { Badge, Button, Surface, Table } from "@cloudflare/kumo";
import Layout from "../components/Layout.astro";
import { getDmarcReports, formatDate, totalPages } from "../lib/db";

const db = Astro.locals.runtime.env.DB;
const url = Astro.url;

const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
const domain = url.searchParams.get("domain") ?? undefined;
const fromParam = url.searchParams.get("from");
const toParam = url.searchParams.get("to");
const from = fromParam != null ? (d => isNaN(d) ? undefined : d)(Math.floor(new Date(fromParam).getTime() / 1000)) : undefined;
const to = toParam != null ? (d => isNaN(d) ? undefined : d)(Math.floor(new Date(toParam).getTime() / 1000)) : undefined;

const { rows, total, pageSize } = await getDmarcReports(db, page, domain, from, to);
const pages = totalPages(total, pageSize);

function pageUrl(p: number): string {
  const params = new URLSearchParams(url.searchParams);
  params.set("page", String(p));
  return `/dmarc-reports?${params}`;
}
---

<Layout title="DMARC Reports">
  <div class="mb-6">
    <h1 class="text-2xl font-semibold text-kumo-default">DMARC Reports</h1>
    <p class="text-sm text-kumo-subtle mt-1">{total} reports total</p>
  </div>

  <!-- Filters -->
  <form method="get" class="flex gap-3 mb-6 flex-wrap items-center">
    <input
      type="text"
      name="domain"
      value={domain ?? ""}
      placeholder="Filter by domain…"
      class="h-8 px-3 text-sm rounded-md border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-placeholder focus:outline-2 focus:outline-kumo-brand w-48"
    />
    <input
      type="date"
      name="from"
      value={fromParam ?? ""}
      class="h-8 px-3 text-sm rounded-md border border-kumo-line bg-kumo-base text-kumo-default focus:outline-2 focus:outline-kumo-brand"
    />
    <input
      type="date"
      name="to"
      value={toParam ?? ""}
      class="h-8 px-3 text-sm rounded-md border border-kumo-line bg-kumo-base text-kumo-default focus:outline-2 focus:outline-kumo-brand"
    />
    <Button type="submit" variant="primary" size="sm">Filter</Button>
    <a href="/dmarc-reports" class="text-sm text-kumo-subtle hover:text-kumo-default transition-colors">Clear</a>
  </form>

  <!-- Table -->
  <Surface className="overflow-x-auto">
    <Table>
      <Table.Header>
        <Table.Row>
          <Table.Head>Report ID</Table.Head>
          <Table.Head>Domain</Table.Head>
          <Table.Head>Org</Table.Head>
          <Table.Head>Begin Date</Table.Head>
          <Table.Head>Policy</Table.Head>
          <Table.Head className="sr-only">Actions</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.length === 0 ? (
          <Table.Row>
            <Table.Cell colSpan={6} className="text-center py-8 text-kumo-inactive">
              No reports found.
            </Table.Cell>
          </Table.Row>
        ) : (
          rows.map((r) => (
            <Table.Row key={r.report_id}>
              <Table.Cell className="font-mono text-xs text-kumo-subtle max-w-32 truncate" title={r.report_id}>
                {r.report_id.slice(0, 12)}…
              </Table.Cell>
              <Table.Cell className="font-mono text-sm">{r.domain}</Table.Cell>
              <Table.Cell className="text-kumo-subtle">{r.org_name}</Table.Cell>
              <Table.Cell className="text-kumo-subtle">{formatDate(r.begin_date)}</Table.Cell>
              <Table.Cell>
                <Badge
                  variant={
                    r.policy_p === "reject"
                      ? "destructive"
                      : r.policy_p === "quarantine"
                        ? "outline"
                        : "secondary"
                  }
                >
                  {r.policy_p}
                </Badge>
              </Table.Cell>
              <Table.Cell>
                <a
                  href={`/dmarc-reports/${r.report_id}`}
                  class="text-sm text-kumo-link hover:text-kumo-link/70 transition-colors"
                >
                  View <span aria-hidden="true">→</span>
                </a>
              </Table.Cell>
            </Table.Row>
          ))
        )}
      </Table.Body>
    </Table>
  </Surface>

  <!-- Pagination -->
  {pages > 1 && (
    <div class="flex justify-center mt-6 gap-1 flex-wrap">
      {page > 1 && (
        <a href={pageUrl(page - 1)} class="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-kumo-line text-kumo-default hover:bg-kumo-recessed transition-colors">
          <span aria-hidden="true">←</span> Prev
        </a>
      )}
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
        <a
          href={pageUrl(p)}
          class={`inline-flex items-center px-3 py-1.5 text-sm rounded-md transition-colors ${
            p === page
              ? "bg-kumo-contrast text-kumo-inverse"
              : "border border-kumo-line text-kumo-default hover:bg-kumo-recessed"
          }`}
        >{p}</a>
      ))}
      {page < pages && (
        <a href={pageUrl(page + 1)} class="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-kumo-line text-kumo-default hover:bg-kumo-recessed transition-colors">
          Next <span aria-hidden="true">→</span>
        </a>
      )}
    </div>
  )}
</Layout>
```

**Step 2: Verify**

```bash
cd /path/to/worktree/ui && pnpm check
```

**Step 3: Commit**

```bash
git add ui/src/pages/dmarc-reports.astro
git commit -m "feat(ui): migrate DMARC reports list to Kumo"
```

---

## Task 5: Update DMARC Report detail page

**Files:**

- Modify: `ui/src/pages/dmarc-reports/[id].astro`

**Step 1: Rewrite `ui/src/pages/dmarc-reports/[id].astro`**

```astro
---
import { Badge, Surface, Table } from "@cloudflare/kumo";
import Layout from "../../components/Layout.astro";
import { getDmarcReport, getDmarcRecords, formatDate } from "../../lib/db";

const db = Astro.locals.runtime.env.DB;
const { id } = Astro.params;

if (id == null) return Astro.redirect("/dmarc-reports");

const report = await getDmarcReport(db, id);
if (!report) return Astro.redirect("/dmarc-reports");

const recordsPromise = getDmarcRecords(db, id);
---

<Layout title={`Report ${report.report_id.slice(0, 12)}`}>
  <a href="/dmarc-reports" class="inline-flex items-center gap-1 text-sm text-kumo-subtle hover:text-kumo-default transition-colors mb-4">
    <span aria-hidden="true">←</span> Back to Reports
  </a>

  <!-- Metadata card -->
  <Surface className="mb-6">
    <div class="p-6">
      <div class="flex items-start justify-between">
        <div>
          <h1 class="text-xl font-semibold text-kumo-default">{report.domain}</h1>
          <p class="text-xs font-mono text-kumo-subtle mt-0.5">{report.report_id}</p>
        </div>
        <Badge
          variant={
            report.policy_p === "reject"
              ? "destructive"
              : report.policy_p === "quarantine"
                ? "outline"
                : "secondary"
          }
        >
          {report.policy_p}
        </Badge>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-sm">
        <div>
          <span class="text-xs text-kumo-inactive uppercase tracking-wide">Org</span>
          <p class="text-kumo-default mt-0.5">{report.org_name}</p>
        </div>
        <div>
          <span class="text-xs text-kumo-inactive uppercase tracking-wide">Date</span>
          <p class="text-kumo-default mt-0.5">{formatDate(report.begin_date)}</p>
        </div>
        <div>
          <span class="text-xs text-kumo-inactive uppercase tracking-wide">DKIM Alignment</span>
          <p class="text-kumo-default uppercase mt-0.5">{report.adkim}</p>
        </div>
        <div>
          <span class="text-xs text-kumo-inactive uppercase tracking-wide">SPF Alignment</span>
          <p class="text-kumo-default uppercase mt-0.5">{report.aspf}</p>
        </div>
      </div>
    </div>
  </Surface>

  <!-- Records section — streamed -->
  {async () => {
    const records = await recordsPromise;

    if (records.length === 0) {
      return (
        <Surface className="p-6 text-kumo-subtle text-sm">
          No records found for this report.
        </Surface>
      );
    }

    const total = records.reduce((s, r) => s + r.count, 0);
    const dkimPass = records.filter((r) => r.dkim_result === "pass").reduce((s, r) => s + r.count, 0);
    const spfPass = records.filter((r) => r.spf_result === "pass").reduce((s, r) => s + r.count, 0);
    const dkimPct = total > 0 ? Math.round((dkimPass / total) * 100) : 0;
    const spfPct = total > 0 ? Math.round((spfPass / total) * 100) : 0;

    return (
      <>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Surface className="p-5">
            <p className="text-xs text-kumo-subtle uppercase tracking-wide">Total Messages</p>
            <p className="text-3xl font-bold text-kumo-default mt-1">{total}</p>
            <p className="text-xs text-kumo-inactive mt-1">{records.length} source IPs</p>
          </Surface>
          <Surface className="p-5">
            <p className="text-xs text-kumo-subtle uppercase tracking-wide">DKIM Pass</p>
            <p className={`text-3xl font-bold mt-1 ${dkimPct === 100 ? "text-kumo-success" : "text-kumo-warning"}`}>
              {dkimPct}%
            </p>
            <p className="text-xs text-kumo-inactive mt-1">{dkimPass} / {total}</p>
          </Surface>
          <Surface className="p-5">
            <p className="text-xs text-kumo-subtle uppercase tracking-wide">SPF Pass</p>
            <p className={`text-3xl font-bold mt-1 ${spfPct === 100 ? "text-kumo-success" : "text-kumo-warning"}`}>
              {spfPct}%
            </p>
            <p className="text-xs text-kumo-inactive mt-1">{spfPass} / {total}</p>
          </Surface>
        </div>

        <Surface>
          <div class="flex items-center justify-between px-6 py-4 border-b border-kumo-line">
            <h2 class="font-semibold text-kumo-default">Per-Record Breakdown</h2>
            {report.raw_xml && (
              <a
                href={`/dmarc-reports/${id}/raw`}
                class="text-sm text-kumo-link hover:text-kumo-link/70 transition-colors"
                download={`${id}.xml`}
              >
                Download XML
              </a>
            )}
          </div>
          <div class="overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Source IP</Table.Head>
                  <Table.Head>Count</Table.Head>
                  <Table.Head>DKIM</Table.Head>
                  <Table.Head>SPF</Table.Head>
                  <Table.Head>Disposition</Table.Head>
                  <Table.Head>Header From</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {records.map((r) => (
                  <Table.Row key={r.id}>
                    <Table.Cell className="font-mono text-sm">{r.source_ip}</Table.Cell>
                    <Table.Cell>{r.count}</Table.Cell>
                    <Table.Cell>
                      <Badge variant={r.dkim_result === "pass" ? "success" : "destructive"}>
                        {r.dkim_result ?? "—"}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge variant={r.spf_result === "pass" ? "success" : "destructive"}>
                        {r.spf_result ?? "—"}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell className="text-kumo-subtle">{r.disposition ?? "—"}</Table.Cell>
                    <Table.Cell className="font-mono text-sm text-kumo-subtle">{r.header_from ?? "—"}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        </Surface>
      </>
    );
  }}
</Layout>
```

**Step 2: Verify**

```bash
cd /path/to/worktree/ui && pnpm check
```

**Step 3: Commit**

```bash
git add ui/src/pages/dmarc-reports/[id].astro
git commit -m "feat(ui): migrate DMARC report detail to Kumo"
```

---

## Task 6: Update TLS Reports list page

**Files:**

- Modify: `ui/src/pages/tls-reports.astro`

**Step 1: Rewrite `ui/src/pages/tls-reports.astro`**

```astro
---
import { Badge, Button, Surface, Table } from "@cloudflare/kumo";
import Layout from "../components/Layout.astro";
import { getTlsReports, formatDate, totalPages } from "../lib/db";

const db = Astro.locals.runtime.env.DB;
const url = Astro.url;

const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
const domain = url.searchParams.get("domain") ?? undefined;

const { rows, total, pageSize } = await getTlsReports(db, page, domain);
const pages = totalPages(total, pageSize);

function pageUrl(p: number): string {
  const params = new URLSearchParams(url.searchParams);
  params.set("page", String(p));
  return `/tls-reports?${params}`;
}
---

<Layout title="TLS Reports">
  <div class="mb-6">
    <h1 class="text-2xl font-semibold text-kumo-default">TLS Reports</h1>
    <p class="text-sm text-kumo-subtle mt-1">{total} reports total</p>
  </div>

  <form method="get" class="flex gap-3 mb-6 items-center">
    <input
      type="text"
      name="domain"
      value={domain ?? ""}
      placeholder="Filter by policy domain…"
      class="h-8 px-3 text-sm rounded-md border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-placeholder focus:outline-2 focus:outline-kumo-brand w-56"
    />
    <Button type="submit" variant="primary" size="sm">Filter</Button>
    <a href="/tls-reports" class="text-sm text-kumo-subtle hover:text-kumo-default transition-colors">Clear</a>
  </form>

  <Surface className="overflow-x-auto">
    <Table>
      <Table.Header>
        <Table.Row>
          <Table.Head>Org</Table.Head>
          <Table.Head>Policy Domain</Table.Head>
          <Table.Head>Policy Type</Table.Head>
          <Table.Head>Date</Table.Head>
          <Table.Head>Failures</Table.Head>
          <Table.Head className="sr-only">Actions</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.length === 0 ? (
          <Table.Row>
            <Table.Cell colSpan={6} className="text-center py-8 text-kumo-inactive">
              No TLS reports found.
            </Table.Cell>
          </Table.Row>
        ) : (
          rows.map((r) => (
            <Table.Row key={r.id}>
              <Table.Cell className="text-kumo-subtle">{r.org_name}</Table.Cell>
              <Table.Cell className="font-mono text-sm">{r.policy_domain}</Table.Cell>
              <Table.Cell>
                <Badge variant="secondary">{r.policy_type}</Badge>
              </Table.Cell>
              <Table.Cell className="text-kumo-subtle">{formatDate(r.begin_date)}</Table.Cell>
              <Table.Cell>
                <span class={r.total_failures > 0 ? "font-semibold text-kumo-danger" : "font-semibold text-kumo-success"}>
                  {r.total_failures}
                </span>
              </Table.Cell>
              <Table.Cell>
                <a
                  href={`/tls-reports/${r.id}`}
                  class="text-sm text-kumo-link hover:text-kumo-link/70 transition-colors"
                >
                  View <span aria-hidden="true">→</span>
                </a>
              </Table.Cell>
            </Table.Row>
          ))
        )}
      </Table.Body>
    </Table>
  </Surface>

  {pages > 1 && (
    <div class="flex justify-center mt-6 gap-1 flex-wrap">
      {page > 1 && (
        <a href={pageUrl(page - 1)} class="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-kumo-line text-kumo-default hover:bg-kumo-recessed transition-colors">
          <span aria-hidden="true">←</span> Prev
        </a>
      )}
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
        <a
          href={pageUrl(p)}
          class={`inline-flex items-center px-3 py-1.5 text-sm rounded-md transition-colors ${
            p === page
              ? "bg-kumo-contrast text-kumo-inverse"
              : "border border-kumo-line text-kumo-default hover:bg-kumo-recessed"
          }`}
        >{p}</a>
      ))}
      {page < pages && (
        <a href={pageUrl(page + 1)} class="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-kumo-line text-kumo-default hover:bg-kumo-recessed transition-colors">
          Next <span aria-hidden="true">→</span>
        </a>
      )}
    </div>
  )}
</Layout>
```

**Step 2: Verify**

```bash
cd /path/to/worktree/ui && pnpm check
```

**Step 3: Commit**

```bash
git add ui/src/pages/tls-reports.astro
git commit -m "feat(ui): migrate TLS reports list to Kumo"
```

---

## Task 7: Update TLS Report detail page

**Files:**

- Modify: `ui/src/pages/tls-reports/[id].astro`

**Step 1: Rewrite `ui/src/pages/tls-reports/[id].astro`**

```astro
---
import { Badge, Surface, Table } from "@cloudflare/kumo";
import Layout from "../../components/Layout.astro";
import { getTlsReport, formatDate } from "../../lib/db";

const db = Astro.locals.runtime.env.DB;
const { id } = Astro.params;

if (id == null) return Astro.redirect("/tls-reports");

const numericId = parseInt(id, 10);
if (isNaN(numericId)) return Astro.redirect("/tls-reports");

const report = await getTlsReport(db, numericId);
if (!report) return Astro.redirect("/tls-reports");

interface FailureDetail {
  "result-type": string;
  "sending-mta-ip": string;
  "receiving-mx-hostname": string;
  "failed-session-count": number;
}
let failures: FailureDetail[] = [];
try {
  failures = report.failure_details
    ? (JSON.parse(report.failure_details) as FailureDetail[])
    : [];
} catch {
  failures = [];
}
---

<Layout title={`TLS Report — ${report.policy_domain}`}>
  <a href="/tls-reports" class="inline-flex items-center gap-1 text-sm text-kumo-subtle hover:text-kumo-default transition-colors mb-4">
    <span aria-hidden="true">←</span> Back to TLS Reports
  </a>

  <Surface className="mb-6">
    <div class="p-6">
      <div class="flex items-start justify-between">
        <div>
          <h1 class="text-xl font-semibold text-kumo-default">{report.policy_domain}</h1>
          <p class="text-sm text-kumo-subtle mt-0.5">{report.org_name}</p>
        </div>
        <Badge variant="secondary">{report.policy_type}</Badge>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-sm">
        <div>
          <span class="text-xs text-kumo-inactive uppercase tracking-wide">Date</span>
          <p class="text-kumo-default mt-0.5">{formatDate(report.begin_date)}</p>
        </div>
        <div>
          <span class="text-xs text-kumo-inactive uppercase tracking-wide">Successful Sessions</span>
          <p class="font-semibold text-kumo-success mt-0.5">{report.total_success}</p>
        </div>
        <div>
          <span class="text-xs text-kumo-inactive uppercase tracking-wide">Failed Sessions</span>
          <p class={`font-semibold mt-0.5 ${report.total_failures > 0 ? "text-kumo-danger" : "text-kumo-success"}`}>
            {report.total_failures}
          </p>
        </div>
        <div>
          <span class="text-xs text-kumo-inactive uppercase tracking-wide">Report ID</span>
          <p class="font-mono text-xs truncate text-kumo-subtle mt-0.5">{report.report_id}</p>
        </div>
      </div>
    </div>
  </Surface>

  {failures.length > 0 ? (
    <Surface>
      <div class="px-6 py-4 border-b border-kumo-line">
        <h2 class="font-semibold text-kumo-default">Failure Details</h2>
      </div>
      <div class="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.Head scope="col">Result Type</Table.Head>
              <Table.Head scope="col">Sending MTA IP</Table.Head>
              <Table.Head scope="col">Receiving MX</Table.Head>
              <Table.Head scope="col">Failed Sessions</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {failures.map((f, i) => (
              <Table.Row key={i}>
                <Table.Cell>
                  <Badge variant="destructive">{f["result-type"]}</Badge>
                </Table.Cell>
                <Table.Cell className="font-mono text-sm">{f["sending-mta-ip"]}</Table.Cell>
                <Table.Cell className="font-mono text-sm text-kumo-subtle">{f["receiving-mx-hostname"]}</Table.Cell>
                <Table.Cell className="font-semibold text-kumo-danger">{f["failed-session-count"]}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Surface>
  ) : (
    <Surface className="p-6 text-center text-kumo-inactive text-sm">
      No failure details recorded for this report.
    </Surface>
  )}
</Layout>
```

**Step 2: Verify**

```bash
cd /path/to/worktree/ui && pnpm check
```

**Step 3: Commit**

```bash
git add ui/src/pages/tls-reports/[id].astro
git commit -m "feat(ui): migrate TLS report detail to Kumo"
```

---

## Notes for Implementer

**Replace `/path/to/worktree` with the actual worktree path:** `/Users/Adam.Du/Developer/dmarc-email-worker/.worktrees/feature/astro-ui`

**If `pnpm check` shows React JSX errors** after Task 1, add to `ui/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types/2023-07-01"],
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

**If `Table.Cell` doesn't accept `colSpan`** — use a regular `<td>` inside `Table.Body` for the empty state row instead.

**If Kumo `Button` type prop conflict** — Kumo's `Button` might not accept `type="submit"`. If so, use a native `<button type="submit" class="...kumo token classes...">` instead.

**If `Surface` doesn't accept `className`** — use `<div class="bg-kumo-base shadow-xs ring ring-kumo-line rounded-lg">` as a manual replacement.

**Dark mode note:** Kumo uses `light-dark()` CSS — the UI follows `prefers-color-scheme` automatically. To always force dark mode, add `color-scheme: dark` to `:root` in `global.css`:

```css
:root {
  color-scheme: dark;
}
```
