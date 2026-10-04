# Big Bear Cabin — Rental Management

Short-term rental management for a single Big Bear cabin: guest booking flow, Stripe
payments, owner finance/tax reporting, maintenance jobs assigned to contractor workers,
and a photo gallery. Next.js 16 (App Router) + React 19 + TypeScript (strict),
Prisma 7 / PostgreSQL (Neon serverless), Auth.js v5 (passwordless email via Resend),
deployed on Vercel. Four roles: `OWNER`, `GUEST`, `WORKER`, `ACCOUNTANT`.

## Commands

- Dev server: `pnpm dev`
- Build: `pnpm build`
- Lint: `pnpm lint` (ESLint, `strictTypeChecked` + `stylisticTypeChecked`)
- Lint fix: `pnpm lint:fix`
- Format (write / check): `pnpm format` / `pnpm format:check` (Prettier)
- Typecheck: `pnpm typecheck` (`tsc --noEmit`)
- Test (watch): `pnpm test`
- Test (single run): `pnpm test:run`
- Test (one file): `pnpm test:run tests/unit/lib/calendar.test.ts`
- Coverage: `pnpm test:coverage`
- Local Postgres (Docker): `pnpm db:up` / `pnpm db:down`
- Migrate dev / prod: `pnpm db:migrate` / `pnpm db:migrate:prod`
- Seed / Studio / regen client: `pnpm db:seed` / `pnpm db:studio` / `pnpm db:generate`

Husky pre-commit runs `bun run lint-staged && bun run typecheck && bun run test:run` —
all must pass. Scripts run with `bun`; dependencies are managed with `pnpm`.

## Architecture

- `src/actions/` — server actions, one file per domain (`bookings`, `finance`,
  `maintenance`, `calendar`, `reports`, `gallery`, `reviews`, `family`,
  `notifications`). Primary mutation layer. See `src/actions/AGENTS.md`.
- `src/app/` — App Router. Route groups: `(public)/` (booking, gallery, contact),
  `(auth)/` (login/verify), `owner/` (OWNER), `worker/` (WORKER), `api/` (cron,
  webhooks, REST).
- `src/lib/` — infrastructure (auth, prisma, stripe, env, notifications, blob,
  rate-limit, cache, signed-token libs). See `src/lib/AGENTS.md`.
- `src/proxy.ts` — global route protection (Next.js 16 proxy pattern). Replaces
  `middleware.ts`; do not add a `middleware.ts`.
- `prisma/schema.prisma` — 23 models, the DB source of truth. Run `pnpm db:migrate`
  after edits.
- `tests/` — Vitest suite.

Auth is enforced in three layers: `src/proxy.ts` (global) → route-group layout guards
→ `assert*()` guards inside each server action.

## Conventions

- Validate authorization first in every server action — they are public HTTP endpoints.
  Use guards from `src/lib/auth/guards.ts` (`assertOwner()`, `assertWorker()`), or the
  `secureAction` wrapper from `src/lib/auth/secure-action.ts` for new actions.
- Server action order: auth guard → Zod validate → Prisma query → cache invalidate.
- Read Zod parse errors via `z.treeifyError(error).properties` (Zod 4) — never `.flatten()`.
- Invalidate caches with the domain helpers in `src/lib/cache/invalidation.ts`:
  `invalidateGallery`, `invalidateBookings`, `invalidateCalendar`, `invalidateReviews`,
  `invalidateFamily`, `invalidateNotifications` — not bare `revalidatePath`.
- Read app config via `env()` from `src/lib/env.ts` (Zod-validated, fails fast at
  startup); add new vars there. Only low-level infra (`prisma.ts`, `rate-limit.ts`,
  `instrumentation.ts`) reads `process.env` directly.
- Terminate notification sends with `.catch(() => {})` — they are non-blocking.
- Filter sensitive fields into DTOs before returning data to clients.
- UI uses the custom forest/wood/stone token palette in `src/app/globals.css`
  (Tailwind v4, CSS `@theme`) — not shadcn, not default Tailwind colors.

## Constraints

- Manage dependencies with `pnpm` (`pnpm-lock.yaml`); the toolchain (node, pnpm, bun,
  biome) is provisioned by `mise`.
- All DB access goes through the Prisma singleton in `src/lib/prisma.ts`.
- Never pass a raw Prisma `Decimal` to a client component — a client extension
  auto-converts Decimals to numbers; rely on it.
- Never use `as any`, `@ts-ignore`, `@ts-expect-error`, or non-null assertions (`!`)
  in `src/` (tests may use `as any`). Null-check, then access.
- Never leave a floating promise — `await`, `void`, or `.catch()` it.
- Gate API routes with `src/lib/api/route-gates.ts`: `authenticatedRoute(roles, handler)`
  for role-gated routes, `cronRoute(handler)` for Vercel cron (verifies the
  `CRON_SECRET` Bearer token). Public routes rate-limit manually with `checkRateLimit`
  from `src/lib/rate-limit.ts`.

## TypeScript strictness gotchas

`tsconfig` adds `noUncheckedIndexedAccess`, `noImplicitReturns`, and
`noFallthroughCasesInSwitch`. The traps ESLint alone won't catch:

- Indexed access (`items[0]`, `obj[key]`) returns `T | undefined` — guard before use.
- A `switch` over an enum must cover every case with no `default` (exhaustiveness check).
- Template literals accept only strings/numbers — never interpolate objects/arrays.

## Testing

- Vitest. Tests live in `tests/`: `unit/`, `data-paths/` (workflows),
  `patterns/` (state machines/cascades), `hardening/` (authz/rate-limit regression).
- Prisma is mocked via `vitest-mock-extended`. Import `prismaMock` from
  `tests/__mocks__/prisma.ts` and `vi.mock('@/lib/prisma', ...)`. Mocks for auth,
  resend, twilio, and upstash also live in `tests/__mocks__/`.
- Build test data with the factories in `tests/fixtures/` (counter-based IDs).
- Run one file: `pnpm test:run <path>`.

## Gotchas

- React Compiler is on (`reactCompiler: true` in `next.config.ts`) — skip manual
  `useMemo`/`useCallback`/`memo` unless profiling proves a need.
- `src/lib/errors.ts` defines `AppError`/`NotFoundError`/etc., but actions currently
  throw generic `Error` — do not assume typed errors are caught downstream.
- Three components use a raw `<img>` deliberately (`ReceiptGallery`, `ReviewForm`,
  `ReviewList`); prefer Next.js `<Image>` elsewhere.
- PDF reports (`AnnualReport`, `MonthlyReport`, `ScheduleE`) use `@react-pdf/renderer`.

## Deployment

- Vercel auto-deploys on merge to `prod` (the default branch). No GitHub Actions CI —
  the Husky pre-commit hook is the only gate.
- Vercel Cron (`vercel.json`): `/api/cron/calendar-sync` every 6h (`0 */6 * * *`) and
  `/api/cron/reminders` daily at 10:00 UTC (`0 10 * * *`). Both require `CRON_SECRET`.

## Path alias

`@/*` maps to `src/*` (tsconfig + vitest.config). No other path aliases.
