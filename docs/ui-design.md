# Astro UI Worker — Frontend Design

## Overview

The UI worker is a read-only Astro v6 application deployed as a second Cloudflare Worker. It queries D1 directly and renders every page server-side with zero client-side JavaScript.

---

## Tech stack

| Tool                  | Version | Role                                     |
| --------------------- | ------- | ---------------------------------------- |
| Astro                 | v6      | SSR framework, `output: "server"`        |
| `@astrojs/cloudflare` | v13     | Cloudflare Workers adapter               |
| `@cloudflare/kumo`    | v1.15   | Cloudflare's React component library     |
| `@astrojs/react`      | v5      | Server-side JSX transform (no hydration) |
| Tailwind CSS          | v4      | Utility classes via `@tailwindcss/vite`  |

---

## Key design decisions

### Zero client-side JavaScript

Kumo React components (`Surface`, `Table`, `Badge`, `Button`) are imported into `.astro` files without any `client:*` directive. This means they are rendered purely server-side — no React runtime is sent to the browser. The `@astrojs/react` integration provides only the JSX transform.

As a consequence, several Kumo components cannot be used and are replaced with native HTML equivalents:

| Kumo component | Problem                                                 | Replacement                               |
| -------------- | ------------------------------------------------------- | ----------------------------------------- |
| `Pagination`   | Requires `setPage` state callback                       | Plain `<a>` links with URL query params   |
| `Input`        | Controlled React component, breaks `method="get"` forms | Native `<input>` with Kumo token classes  |
| `Button`       | Renders a disclosure marker when server-rendered        | Native `<button>` with Kumo token classes |

### Kumo design tokens (Tailwind v4)

Kumo exposes CSS custom properties consumed as Tailwind utilities. Key tokens used throughout:

| Token class          | Purpose                                    |
| -------------------- | ------------------------------------------ |
| `bg-kumo-recessed`   | Page background (light grey)               |
| `bg-kumo-surface`    | Card/Surface background (white)            |
| `bg-kumo-tint`       | Hover state on rows                        |
| `bg-kumo-brand`      | Primary brand colour (blue banner headers) |
| `text-kumo-default`  | Primary body text                          |
| `text-kumo-subtle`   | Secondary / muted text                     |
| `text-kumo-inactive` | Placeholder / disabled text                |
| `text-kumo-link`     | Link colour                                |
| `text-kumo-success`  | Pass / accepted state                      |
| `text-kumo-danger`   | Fail / rejected state                      |
| `border-kumo-line`   | Divider lines                              |

Light/dark mode is handled automatically via Kumo's `light-dark()` CSS — no manual dark mode classes required.

### Kumo `Table` cell padding

Kumo's `Table.Head` and `Table.Cell` components apply no padding by default. Every cell requires explicit `className="px-4 py-3"` (or the columns collapse together).

### Plain HTML vs React JSX in `.astro` files

- Plain HTML elements (`<p>`, `<div>`, `<span>`, `<tr>`, `<td>`) use `class=`.
- Kumo React components (`Surface`, `Table.Cell`, `Badge`) use `className=`.
- `Table.Cell` does not accept `colSpan` without TypeScript errors — empty-state rows use `<tr><td colspan="N">` instead.

---

## Page structure

### Dashboard (`/`)

- Stat cards (DMARC reports this month, TLS reports, DKIM pass rate, SPF pass rate)
- Recent DMARC reports table (last 10 entries)

### DMARC Reports list (`/dmarc-reports`)

- Filter form: domain text input, date range pickers, Filter/Clear buttons
- Paginated table: Report ID (truncated), domain, org, begin date, policy badge, View link
- URL-based pagination preserves filter state across pages

### DMARC Report detail (`/dmarc-reports/[id]`)

See [DMARC detail page design](#dmarc-detail-page-design) below.

### TLS Reports list (`/tls-reports`)

- Filter form: policy domain input
- Paginated table: org, policy domain, policy type badge, date, failure count, View link

### TLS Report detail (`/tls-reports/[id]`)

- Metadata card: org, policy domain, policy type, date range, success/failure counts
- Failure details table (parsed from `failure_details` JSON column)

---

## DMARC detail page design

The detail page (`/dmarc-reports/[id]`) follows the design pattern of DMARC reporting tools like Postmark's DMARC viewer.

### Banner header

A `bg-kumo-brand` panel spanning the top of the content area shows:

- **Left**: Day of week + full date (from `begin_date`)
- **Right** (2-column grid): domain, number of reports, total emails in the report; accepted count + %, quarantined count + %, rejected count + %

Accepted/quarantined/rejected are derived from the `disposition` field on `dmarc_records` rows:

- `disposition = "none"` → accepted
- `disposition = "quarantine"` → quarantined
- `disposition = "reject"` → rejected

### Sender-grouped rows

Records are grouped by `envelope_from` (falling back to `header_from`, then `source_ip`). Each unique sender domain becomes one expandable row showing:

- **Sender**: favicon (DuckDuckGo favicon API) + domain + "from N host(s)"
- **Volume**: aggregate message count across all source IPs for that sender
- **DMARC Result**: `✓ DKIM Aligned` / `✓ SPF Aligned` / `✗ Failed` — pass if any record in the group has `dkim_result = "pass"` or `spf_result = "pass"` respectively
- **Disposition**: `✓ None` / `✗ Quarantine` / `✗ Reject`
- **Details**: `▾` toggle icon

### Expandable rows

Native HTML `<details><summary>` — no JavaScript. The summary element is the visible row; the child `<div>` is the expanded sub-table.

CSS grid (`grid-cols-[1fr_5rem_13rem_10rem_4rem]`) replaces a `<table>` for the outer row layout, enabling `<details>` nesting which is not valid inside `<tbody>`.

The expanded sub-table uses a recessed background and shows per-source-IP breakdown: source IP (shown as "Reported by" context), volume, SPF alignment, DKIM alignment, overall DMARC pass/fail, disposition.

### Org favicons

Sender domain favicons are fetched from the DuckDuckGo favicon API:

```
https://icons.duckduckgo.com/ip3/{domain}.ico
```

This is a read-only external request made by the browser when the page is rendered, not by the worker.

### Report metadata footer

A `<dl>` grid at the bottom shows: report ID (with Download XML link if `raw_xml` is present), reporting org, period begin/end (UTC), DMARC policy, DKIM alignment mode, SPF alignment mode.

---

## Astro v6 / `@astrojs/cloudflare` v13 migration notes

These breaking changes were encountered when upgrading from Astro v5:

| Change                         | v5                                                    | v6                                                                  |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------- |
| View transitions component     | `import { ViewTransitions } from "astro:transitions"` | `import { ClientRouter } from "astro:transitions"`                  |
| Cloudflare env access          | `Astro.locals.runtime.env.DB`                         | `import { env } from "cloudflare:workers"; env.DB`                  |
| `platformProxy` adapter option | present                                               | removed                                                             |
| Assets output directory        | `dist/`                                               | `dist/client/`                                                      |
| `env.d.ts` pattern             | `/// <reference types="@cloudflare/workers-types" />` | `declare namespace Cloudflare { interface Env { DB: D1Database } }` |
| Pkl config `main` field        | `main = "dist/_worker.js"`                            | removed (not needed)                                                |
| Pkl config `assets.directory`  | `"./dist"`                                            | `"./dist/client"`                                                   |
