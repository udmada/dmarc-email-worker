# Astro DMARC Viewer UI Design

**Date:** 2026-03-20
**Goal:** Build a lightweight read-only DMARC/TLS-RPT viewer as an Astro SSR app within the existing monorepo, querying D1 directly with zero client-side JavaScript.

---

## Stack

- **Astro 5** — SSR, MPA with View Transitions (browser-native, no JS bundle)
- **`@astrojs/cloudflare`** — Workers deployment mode (Pages support removed)
- **Tailwind v4 + DaisyUI** — dark admin theme, zero JS components
- **No React, no islands, no charts** — pure `.astro` files throughout
- **D1** — direct binding to existing `dmarc_reports` database (read-only)
- **Cloudflare Access + Authentik** — auth enforced at edge, zero app code

---

## Repo Structure

```
dmarc-email-worker/
├── src/                        ← email worker (unchanged)
├── wrangler.toml               ← generated from Pkl
├── ui/                         ← Astro UI package
│   ├── src/
│   │   ├── components/
│   │   │   ├── Layout.astro    ← sidebar + <ViewTransitions />
│   │   │   └── Sidebar.astro
│   │   ├── lib/
│   │   │   └── db.ts           ← typed D1 query helpers
│   │   └── pages/
│   │       ├── index.astro     ← redirect → /dashboard
│   │       ├── dashboard.astro
│   │       ├── dmarc-reports.astro
│   │       ├── dmarc-reports/[id].astro
│   │       ├── tls-reports.astro
│   │       └── tls-reports/[id].astro
│   ├── astro.config.mjs
│   ├── package.json
│   └── wrangler.toml           ← generated from Pkl
├── pkl/
│   ├── wrangler.schema.pkl     ← shared wrangler config types
│   ├── worker.pkl              ← email worker config
│   └── ui.pkl                  ← Astro UI config
├── mise.toml                   ← updated with deploy tasks
└── pnpm-workspace.yaml         ← updated to include ui/
```

---

## Pages

| Route                 | D1 queries                                                                       | UI                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`          | COUNT reports/TLS this month, overall DKIM/SPF pass rate, 10 most recent reports | 4 stat cards, recent activity table                                                                                                                                 |
| `/dmarc-reports`      | Paginated `dmarc_reports`, filter by domain/date via URL params                  | Table: report ID, domain, begin date, DKIM %, SPF %, policy badge, view link. URL-based pagination (`?page=N`)                                                      |
| `/dmarc-reports/[id]` | Report row + all `dmarc_records` for that report                                 | Metadata header streamed first; stat cards (total records, DKIM %, SPF %); records table (source IP, count, DKIM result, SPF result, disposition); raw XML download |
| `/tls-reports`        | Paginated `tls_reports`, filter by domain                                        | Table: report ID, org name, policy domain, policy type, total failures, date, view link                                                                             |
| `/tls-reports/[id]`   | Single `tls_reports` row, parse `failure_details` JSON                           | Failure detail table: result type, sending MTA IP, receiving MX, failed session count                                                                               |

**Streaming:** `/dmarc-reports/[id]` streams the metadata header immediately, defers the records table.

**Pagination:** URL-based, server-rendered, no JS.

**Dark mode:** Always dark — no toggle.

---

## D1 Binding

The UI worker binds to the same database as the email worker:

```toml
[[d1_databases]]
binding = "DB"
database_name = "dmarc_reports"
database_id = "0acb0daf-685a-4617-a248-4255e36d1516"
```

Read-only queries only. No writes from the UI.

---

## Pkl Config Generation

Shared wrangler config values (database ID, compatibility flags, compatibility date) defined once in `pkl/wrangler.schema.pkl`. `pkl/worker.pkl` and `pkl/ui.pkl` extend the schema for their respective workers. `wrangler.toml` files are generated, not committed (gitignored).

---

## Mise Tasks

```toml
[tasks."generate:pkl"]
description = "Generate wrangler.toml files from Pkl"
run = "pkl eval --format toml pkl/worker.pkl > wrangler.toml && pkl eval --format toml pkl/ui.pkl > ui/wrangler.toml"

[tasks."deploy:worker"]
description = "Deploy email worker"
depends = ["generate:pkl"]
run = "wrangler deploy"

[tasks."deploy:ui"]
description = "Deploy Astro UI"
depends = ["generate:pkl"]
dir = "ui"
run = "wrangler deploy"

[tasks.deploy]
description = "Deploy all"
depends = ["deploy:worker", "deploy:ui"]
```

---

## Auth

Cloudflare Access application wraps the UI worker URL. Identity provider set to Authentik (generic OIDC) at `auth.udp.nz`. Policy allows specific Authentik users/groups. No session handling, no middleware, no auth code in the Astro app.

---

## Out of Scope

- Write operations (report upload, deletion)
- Dark mode toggle
- Client-side filtering/sorting (all filtering via URL params, server-rendered)
- Analytics Engine queries (data is in D1)
- Domains list page (single domain in use — YAGNI)
