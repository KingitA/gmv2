# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (uses webpack bundler)
npm run build     # Production build
npm run lint      # ESLint check
npm run start     # Run production server
```

There are no tests in this project.

## Architecture Overview

**GM ERP** is a full-stack Next.js 16 (App Router) application for a logistics/distribution company. It manages orders, inventory, invoicing, payments, and delivery routes, with a strong emphasis on AI-powered automation for email processing.

### Tech Stack
- **Frontend:** React 19 + Next.js 16 App Router, Radix UI, Tailwind CSS 4
- **Database:** Supabase (PostgreSQL) — accessed via three clients:
  - `lib/supabase/client.ts` — browser client
  - `lib/supabase/server.ts` — server/API routes (session-aware)
  - `lib/supabase/admin.ts` — service role client (bypasses RLS, use carefully)
- **AI:** Claude (Anthropic) for classification/extraction, Gemini (Google) for OCR and attachment parsing
- **Email:** Gmail API via Google OAuth, Google Pub/Sub push webhooks

### Key Directories
- `app/api/` — All API routes (Next.js Route Handlers)
- `app/` — UI pages (App Router)
- `components/` — Reusable UI components
- `lib/ai/` — AI integration layer (email pipeline, Claude/Gemini wrappers, prompts)
- `lib/actions/` — Server actions
- `lib/services/` — Business logic (matching, pricing, OCR)
- `lib/supabase/` — Database client setup
- `lib/types/` and `lib/types.ts` — TypeScript type definitions
- `supabase/migrations/` — SQL migration files

### Authentication
`middleware.ts` protects all routes via Supabase session checks, redirecting unauthenticated users to `/auth/login`. Excluded paths: `/api/auth/**`, `/api/ai/gmail/webhook`, `/api/imports/webhook`, `/api/cron/**`. Google OAuth flow: `app/api/auth/google/`.

### AI Email Processing Pipeline

The core automated feature. Entry points: Gmail webhook (`app/api/ai/gmail/webhook/route.ts`), cron job (`app/api/cron/gmail-sync/route.ts`), or manual sync. The pipeline:

1. **Download** email + attachments (`lib/ai/gmail.ts`)
2. **Extract** attachment content — Gemini OCR for images/PDFs, direct XLSX parse for Excel (`lib/ai/attachment-content-extractor.ts`)
3. **Classify** with Claude — returns type (pedido, factura_proveedor, pago, cambio_precio, reclamo, etc.) + extracted data (`lib/ai/claude.ts`, prompts in `lib/ai/prompts.ts`)
4. **Route** to type-specific processors:
   - `lib/ai/email-order-processor.ts` — identifies client, matches products, creates `pedidos` or sends to `imports` for manual review
   - `lib/ai/email-invoice-processor.ts` — creates `comprobantes_proveedor`
   - `lib/ai/email-payment-processor.ts` — records payment
   - `lib/ai/email-pricelist-processor.ts` — creates `imports` of type `price_list`

### Product Matching
When AI extracts order/invoice items, products must be matched against the catalog. The matcher (`lib/services/matching.ts`) uses: exact code/EAN matching → fuzzy text normalization → vector embeddings for semantic similarity. Uncertain matches go to the `imports` + `import_items` tables for manual review at `/imports`.

### Pricing Engine
Manual orders use a cascade discount calculation (`lib/pricing/` and `lib/pricing.ts`): base price → supplier discount → operative cost → IVA (tax) → freight % (by zone) → commission. **AI-processed orders use prices directly from the `articulos` table, not this engine.**

### Imports Review Flow
When the AI is uncertain (client not found, products unmatched), records go to `imports`/`import_items` tables. The review UI at `/imports` and `/clientes-pedidos` (import-review section) lets users correct matches and approve to create the actual records.

### Important Naming Conventions
The codebase is bilingual — Spanish domain terms in DB/routes, English in general code:
- `pedidos` = orders, `clientes` = clients, `proveedores` = suppliers
- `articulos` = products/articles, `viajes` = delivery trips
- `comprobantes_venta` = sales invoices, `comprobantes_proveedor` = supplier invoices
- `cuenta_corriente` = account statement, `vencimientos` = due dates/expirations
