# 4frames-core-api — Architecture Guide

pnpm monorepo with the 4Frames backend: the API, the processing worker, the email notifier
and a shared package. Read this before adding or changing any endpoint or package.

## Monorepo layout

```
apps/
  api/          @4frames/api       Express 5 REST API (hexagonal, see "Layers" below)
  worker/       @4frames/worker    SQS consumer + ffmpeg (scaffold only: main.ts with graceful shutdown)
  notifier/     @4frames/notifier  Redis subscriber + email (scaffold only: main.ts with graceful shutdown)
packages/
  shared/       @4frames/shared    code and contracts used by more than one app
    prisma/                        schema.prisma, models/*.prisma, migrations/, seeds/
    prisma.config.ts               Prisma CLI config (runs with cwd = packages/shared)
    src/
      env/        loadEnv, parseEnv + zod schemas; env/load.ts is a side-effect import
      logger/     pino root factory, PinoLoggerAdapter, Logger interface
      prisma/     prisma client singleton, buildDatabaseUrl, generated enums/types re-exported
      jobs/       job statuses, S3 key builders/parsers, Redis channel names, job event schemas
      aws/        createS3Client, createSqsClient
      redis/      createRedisClient (lazyConnect)
      process/    registerGracefulShutdown
      generated/  Prisma Client output (gitignored, created by `pnpm db:generate`)
infra/localstack/init/             LocalStack bootstrap scripts
tsconfig.base.json                 compiler options shared by every package
eslint.config.js, .prettierrc.js   one lint config for the whole repo
docker-compose.yml, .env           one Compose file and one .env at the root
```

### Shared package rules

- Put code in `packages/shared` only when two or more apps need it, or when it is a contract
  between apps (S3 keys, Redis channels, event payloads, statuses). App-specific code stays in
  the app. No Express, HTTP or request-scoped code in `shared`.
- Import through subpaths, never deep paths: `@4frames/shared/prisma`, `/env`, `/logger`,
  `/jobs`, `/aws`, `/redis`, `/process`. The root `@4frames/shared` only re-exports the light
  modules (env, jobs, logger, process). Prisma, AWS and Redis stay behind subpaths so importing
  a contract never opens a database connection or loads an SDK.
- Apps resolve `@4frames/shared` at runtime and in `tsc` through the package `exports`, which
  point to `dist`. After changing `shared`, run `pnpm --filter @4frames/shared build` (or keep
  `pnpm dev:shared` running). Jest maps `@4frames/shared/*` straight to `packages/shared/src`,
  so tests never need a build.
- Every app entrypoint starts with `import '@4frames/shared/env/load';` so the root `.env` is
  loaded before any module reads `process.env`. Variables already set (Compose, CI) win.
- When you add a subpath, update `exports` in `packages/shared/package.json` and keep the
  subpath name equal to the folder name under `src/` (the Jest mapper relies on that).

## Stack

- Express 5, Zod (validation), Prisma 7 with the `pg` driver adapter, JWT (jsonwebtoken + bcrypt)
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` for presigned upload URLs
- LocalStack (S3 only, for now) for local dev — see `infra/localstack/`
- Manual DI via a `Container` singleton (no framework like InversifyJS/tsyringe)
- Jest + ts-jest for tests, one `jest.config.ts` per package

## Layers in `apps/api/src` (strict, don't cross them)

```
domain/
  ports/service/*.interface.ts   interfaces implemented by infra/services
  ports/use-case.ts              generic IUseCase<TInput, TOutput>
  error/domain-error.ts          DomainError + DomainErrorTypes
application/
  use-case/<aggregate>/<action>/<action>.usecase.ts + .dto.ts
  error/*.ts                     ApplicationError subclasses (HTTP-facing errors)
infra/
  http/controller/<aggregate>/<aggregate>.controller.ts   implements IController
  http/route/<aggregate>.ts                               Express Router
  http/validators/<aggregate>/*.validator.ts              Zod schemas
  http/docs/paths/<aggregate>/                             OpenAPI path definitions
  services/*.service.ts           concrete implementations of domain ports (Prisma, S3, JWT)
  logging/                        appLogger + pino-http, request context mixin (uses @4frames/shared/logger)
dependencies/
  container.ts                    the DI Container class
  infra.dependency.ts             registers infra services
  use-case.dependency.ts          registers use cases (wires them to infra services)
  controller.dependency.ts        registers controllers (wires them to use cases)
```

Use cases only depend on `domain/ports` interfaces — never import Prisma, the AWS
SDK, or Express types into `application/`. Pure contracts from `@4frames/shared/jobs`
(key builders, statuses) are allowed there; see `application/use-case/video/video-storage-key.ts`.
Controllers only depend on `IUseCase<TInput, TOutput>` — never call a service or
Prisma directly from a controller. Infra services get Prisma from
`import { prisma } from '@4frames/shared/prisma'`.

## Adding a new endpoint

Follow the exact shape of the `video` aggregate (`create-video-job`,
`complete-video-job`, `get-video-job-status`) — don't invent a new convention.
All paths below are relative to `apps/api/src`.

1. **Port** (if a new infra capability is needed): add a method to the relevant
   `domain/ports/service/*.interface.ts`, or create a new interface if it's a new
   kind of service.
2. **Use case**: `application/use-case/<aggregate>/<action>/<action>.usecase.ts` +
   `.dto.ts` (separate `InputDTO`/`OutputDTO` interfaces). Constructor takes an
   object of its dependencies (services), typed by their port interfaces — see
   `CompleteVideoJobUseCase` for the pattern of validating state before mutating it.
3. **Validator** (body/query, if any): Zod schema in
   `infra/http/validators/<aggregate>/<name>.validator.ts`. Path params (e.g. numeric
   IDs) are validated inline in the controller with a regex + `InvalidRequestParamError`
   — see `CompleteVideoJobController` — not with Zod, since `validateMiddleware`
   only wires up to `req.body`/`req.query` today.
4. **Controller**: `infra/http/controller/<aggregate>/<action>.controller.ts`,
   implements `IController` (single `handle(req, res)` method). One controller per
   route, not one per aggregate — e.g. video has three separate controllers, not
   one `VideoController` with multiple methods.
5. **Route**: wire it into the aggregate's existing `infra/http/route/<aggregate>.ts`.
   Apply `authMiddleware` for any route requiring a logged-in user, then
   `validateMiddleware(schema)` if there's a body schema, then
   `controllerWrapper(YourController.name)`.
6. **Register in the Container**: add the service to `infra.dependency.ts` (if new),
   the use case to `use-case.dependency.ts` (resolving its dependencies via
   `c.resolve(ServiceClass.name)`), and the controller to `controller.dependency.ts`
   (resolving the use case the same way). Keys are always `ClassName.name` — never
   a string literal.
7. **OpenAPI docs**: add a path file under `infra/http/docs/paths/<aggregate>/`,
   register it in that folder's `index.ts` and in `infra/http/docs/openapi.ts`.
   Reuse `docs/responses/*.ts` (bad-request, unauthorized, not-found,
   too-many-requests) instead of inlining response schemas.
8. **Tests**: `.spec.ts` next to the use case, and under `__tests__/` next to the
   controller (matches the existing layout — use case specs are siblings, controller
   specs are in a subfolder). Mock dependencies as plain Jest mocks matching the
   port interface — never hit Prisma or the AWS SDK in a use case/controller test.
   To mock Prisma in a service test, use `jest.mock('@4frames/shared/prisma', () => ({ prisma: ... }))`
   (see `user-authenticator.service.spec.ts`).
   Cover: happy path, not-found/wrong-owner (same error/response either way — see
   "Authorization" below), and any domain-specific invalid-state transitions.

## Database (Prisma)

- Schema is split in `packages/shared/prisma/models/*.prisma`; the generator writes the client to
  `packages/shared/src/generated/prisma` (gitignored). `pnpm install` runs `db:generate` and builds
  `shared` automatically via the root `postinstall`.
- Create migrations with `pnpm db:migrate` (runs `prisma migrate dev` in `packages/shared`). Never
  edit a migration that is already on `develop`; add a new one.
- `prisma.config.ts` calls `loadEnv()`, so the Prisma CLI reads the root `.env` even though it runs
  with `cwd = packages/shared`.

## Error handling

Two parallel error families exist — know which one to use:

- **`DomainError`** (`domain/error/domain-error.ts`) + `DomainErrorTypes`
  (`NOT_FOUND`, `INVALID_STATE`, `PRECONDITION_FAILED`, `CONFLICT`,
  `INVALID_ARGUMENT`, `VALIDATION_ERROR`) — for business-rule violations inside a
  use case (job not found, wrong owner, invalid state transition, missing S3
  object). Mapped to HTTP status via `types-to-status-code.ts`.
- **`ApplicationError`** subclasses (`application/error/*.ts`, e.g. `AuthError`,
  `InvalidRequestParamError`, `VideoValidationError`) — for HTTP-boundary
  validation (malformed path param, auth failure). Each subclass sets its own
  `status` in the constructor.

Both are correctly translated to HTTP responses inside `controllerWrapper`
(via `http-error-handler.ts`), which is the path every route added via the
container takes. The global Express `error-handler.middleware.ts` (registered
directly on the app, outside `controllerWrapper`) only explicitly handles
`SyntaxError` (bad JSON) and `AuthError` — anything else reaching it falls
through to a generic 500. In practice this means: as long as your controller
throws inside its `handle()` and goes through `controllerWrapper`, both error
families are handled correctly. Don't throw from middleware registered outside
`controllerWrapper` expecting `DomainError`/other `ApplicationError` subclasses
to be translated correctly there — this is a known gap, not a place to add
one-off handling.

## Authorization pattern

Every authenticated route gets `userId` from `req.authenticated.userId` (set by
`authMiddleware` after verifying the JWT). When a use case looks up a
user-owned resource by ID, treat "resource doesn't exist" and "resource exists
but belongs to another user" identically — same `DomainError` with
`NOT_FOUND`, same message. Never leak "it exists but isn't yours" as a
different error/status. See `CompleteVideoJobUseCase` and
`GetVideoJobStatusUseCase` for the reference implementation.

## LocalStack / S3

- `infra/localstack/init/create-bucket.sh` runs on container bootstrap: creates
  the bucket (`S3_BUCKET_NAME`, default `4frames-videos`) and sets a permissive
  CORS policy (needed because uploads are a direct browser `PUT` to a presigned
  URL — without bucket CORS, the browser preflight fails even though a plain
  `curl` PUT would succeed).
- `createS3Client` (`packages/shared/src/aws/s3.ts`) sets
  `requestChecksumCalculation: 'WHEN_REQUIRED'` — without this, AWS SDK v3
  attaches a mandatory CRC32 checksum to presigned URLs that LocalStack (and a
  plain browser/curl `PUT`) rejects with `400 InvalidRequest`. Don't remove this
  setting. The API's `S3PresignedUrlFactory` uses this factory.
- If you change the bucket's init script after LocalStack is already running,
  re-apply it manually (`docker exec 4frames-localstack awslocal s3api ...`) or
  recreate the container — `ready.d` scripts only run once, on first boot.
- Shell scripts must stay LF (`.gitattributes` enforces it); a CRLF shebang makes
  LocalStack skip the script with "No such file or directory".

## Docker

- Build context is always the monorepo root: `docker build -f apps/api/Dockerfile -t 4frames-api .`
- The production image installs with `--ignore-scripts` (the root `postinstall` needs sources that
  are copied later), builds `shared` and `api`, then `pnpm deploy --prod --legacy` copies only the
  API with production dependencies. It runs `node dist/main.js` as the `node` user.
- `apps/api/dev.Dockerfile` + `docker-entrypoint.sh` back the `node` Compose service (install,
  generate, build shared, migrate deploy, seed, hot reload). Each package's `node_modules` is an
  anonymous volume so host-installed modules never leak into the Linux container.

## Commands (run at the repo root)

```bash
pnpm install          # also generates the Prisma Client and builds @4frames/shared
pnpm dev:api          # builds shared, then ts-node-dev for the API (also dev:worker, dev:notifier)
pnpm dev:shared       # tsc --watch for packages/shared
pnpm build            # every package, in dependency order
pnpm type-check       # builds shared, then type-checks every package
pnpm lint             # eslint for the whole repo (lint:fix to autofix)
pnpm test             # jest in every package
pnpm --filter @4frames/api test   # a single package
pnpm db:migrate       # prisma migrate dev (packages/shared)
pnpm db:deploy        # prisma migrate deploy
pnpm db:generate      # prisma generate
pnpm db:seed          # seed test users
```

Run `pnpm lint`, `pnpm type-check`, `pnpm test` and `pnpm build` before considering any change done.
For endpoints touching S3, do a real curl smoke test against LocalStack
(login → create → PUT → complete → get-status) — unit test coverage on
`video-job.service.ts`/`s3-presigned-url.service.ts` is currently low (they're
thin Prisma/AWS SDK adapters), so a manual end-to-end check is the only thing
that catches integration issues like the CORS/checksum gaps above.

## Known gaps (per ADR-001)

- No SQS, no worker logic, no ffmpeg processing. `apps/worker` and `apps/notifier`
  only start, log and shut down gracefully. A job confirmed via
  `POST /videos/:jobId/complete` reaches `QUEUED` and stays there forever —
  nothing consumes the queue yet.
- No `GET /videos` (list jobs for the current user).
- No `GET /videos/:jobId/download` (presigned/CloudFront download URL when
  `DONE`).
- The `jobId` is the raw Postgres `SERIAL`. It's used today in a
  publicly-shareable frontend URL (`/jobs/:jobId`) — this is enumerable, which
  is a real weakness for that use case, but no ticket has replaced it with a
  UUID/hash yet.
- `POST /auth` vs. the ADR's documented `POST /auth/login` — the route name
  never got reconciled with the ADR text; not a functional issue, just a doc
  mismatch to be aware of.
