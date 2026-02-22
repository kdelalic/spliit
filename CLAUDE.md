# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint
npm run check-types  # TypeScript type check (tsc --noEmit)
npm run prettier     # Format src/ with Prettier
npm run test         # Run Jest tests
```

Run a single test file:
```bash
npx jest src/lib/utils.test.ts
```

Database:
```bash
./scripts/start-local-db.sh   # Start local PostgreSQL (if no existing server)
npx prisma migrate dev        # Create and apply a new migration
npx prisma generate           # Regenerate Prisma client after schema changes
```

## Architecture

Spliit is a Next.js 16 App Router application for splitting expenses among groups, with no user authentication — groups are accessed via shareable URLs.

### Data layer

**Prisma** (`prisma/schema.prisma`) with PostgreSQL. Core models:
- `Group` — top-level container; accessed by ID in the URL
- `Participant` — members of a group (no auth, just names)
- `Expense` — monetary amounts with split configuration and optional recurrence
- `ExpensePaidFor` — junction table; the `shares` column holds amount/percentage/share-count depending on `splitMode`
- `Category`, `Activity`, `ExpenseDocument`, `RecurringExpenseLink`

All monetary amounts are stored as integers (cents). `Prisma.Decimal` is used for conversion rates; SuperJSON handles serialization transparently.

### API layer — tRPC

`src/trpc/` defines the full API:
- `init.ts` — tRPC context with SuperJSON transformer
- `client.tsx` — `TRPCProvider` wrapping `QueryClientProvider`
- `routers/_app.ts` — root router aggregating sub-routers
- `routers/groups/` — procedures for groups, expenses, balances, stats, activities

All tRPC procedures are in `src/trpc/routers/`. They validate input with Zod, call functions from `src/lib/api.ts`, and return typed data. The HTTP endpoint is `src/app/api/trpc/[trpc]/route.ts`.

### Business logic

`src/lib/` contains the core logic:
- `api.ts` — all database operations (create/update/delete for groups, expenses, etc.)
- `balances.ts` — balance calculation and the greedy reimbursement-suggestion algorithm
- `schemas.ts` — Zod schemas for all forms (`GroupFormSchema`, `ExpenseFormSchema`)
- `hooks.ts` — shared React hooks (`useActiveUser`, `useCurrencyRate`, etc.)
- `utils.ts` — currency formatting, amount conversion (minor↔major units), date helpers
- `env.ts` — Zod-validated environment variables with feature flags

### App Router pages

`src/app/groups/[groupId]/` is the main section. The layout loads the group in a server component and passes it down via `CurrentGroupContext` (`current-group-context.tsx`). Sub-routes: `expenses/`, `balances/`, `activity/`, `stats/`, `edit/`.

### Expense split modes

`SplitMode` enum: `EVENLY` | `BY_SHARES` | `BY_PERCENTAGE` | `BY_AMOUNT`. The `ExpensePaidFor.shares` column is reused for all modes. Validation in `ExpenseFormSchema` enforces that BY_PERCENTAGE shares sum to 100 and BY_AMOUNT shares sum to the total.

### Internationalization

`next-intl` with 25 locales. Message files are in `messages/{locale}.json`. Locale is detected server-side in `src/i18n/request.ts` and merged with English as a fallback. Client components use the `useTranslations()` hook.

### Feature flags

Optional features are toggled via environment variables (validated in `src/lib/env.ts`):
- `NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS` + S3 config — image attachments
- `NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT` + `OPENAI_API_KEY` — receipt scanning
- `NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT` — AI category suggestion

### React Query caching

`src/trpc/query-client.ts` sets a 30-second stale time globally. Server-side dehydration includes pending queries for SSR. `src/app/cached-functions.ts` wraps database calls with React's `cache()` for request-scoped memoization.

### Path alias

`@/` maps to `src/` (configured in `tsconfig.json`).
