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
- Local dev with Docker Compose: PostgreSQL 16, Redis 7, Mailpit and LocalStack (S3 + SQS) — see
  "Local environment" below
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
   `infra/http/validators/<aggregate>/<name>.validator.ts`. Path params are parsed in the
   controller, not by `validateMiddleware` (it only validates `req.body` today): a `:jobId`
   is a UUID and goes through `parseJobIdParam`
   (`infra/http/validators/video/job-id-param.validator.ts`), which throws
   `InvalidRequestParamError` (400) — see `CompleteVideoJobController`.
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
- `prisma migrate dev` refuses non-interactive shells (agents, CI). There, generate the SQL with
  `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma --script` (inside
  `packages/shared`), write `prisma/migrations/<UTC timestamp>_<name>/migration.sql` by hand, apply it
  with `pnpm db:deploy`, and confirm there is no drift: the same `migrate diff` with `--exit-code`
  must exit 0.
- `video_jobs.id` is a UUID generated by Postgres (`gen_random_uuid()`), never a sequence: it shows up
  in shareable URLs. `video_jobs.file_size` is `BIGINT`; `VideoJobService.toRecord` converts it to
  `number`, because a `bigint` cannot be serialized to JSON.

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

## Local environment (Compose + LocalStack)

- One `.env` at the root, with **host** addresses (`localhost`). Apps started with `pnpm dev:*` use it
  as is. The `migrate` and `api` Compose services load the same file and override only the internal
  hosts through the `x-container-endpoints` block (`postgres`, `localstack`, `redis`, `mailpit`).
  When you add an env var that points to another container, add its override there too.
- `docker compose up -d --build` runs everything; `docker compose up -d postgres redis mailpit localstack`
  runs only infrastructure for host development. Both modes bind the API to port 3000.
- `migrate` is a one-shot service (`pnpm db:deploy && pnpm db:seed`); `api` waits for it with
  `service_completed_successfully`. Neither has `container_name`, so services can be scaled later.

## LocalStack / S3 / SQS

- `infra/localstack/init/*.sh` run in name order on every LocalStack start (the `ready.d` hook), and the
  `localstack` healthcheck only turns healthy after `/_localstack/init/ready` reports all of them
  completed:
  - `00-s3.sh`: bucket (`S3_BUCKET_NAME`) + permissive CORS. Uploads are a direct browser `PUT` to a
    presigned URL; without bucket CORS the browser preflight fails even though `curl` works.
  - `10-sqs.sh`: `4frames-video-uploads` (VisibilityTimeout 600, long polling 20 s) with a redrive
    policy to `4frames-video-uploads-dlq` after 3 receives.
  - `20-s3-notification.sh`: queue policy for `s3.amazonaws.com` + bucket notification
    `s3:ObjectCreated:*` filtered by prefix `videos/` (writes to `frames/` and `zips/` must not loop).
- Scripts must be idempotent, LF (`.gitattributes` enforces it) and **executable**: LocalStack calls
  them directly (`subprocess.call(executable=path)`). This clone runs with `core.filemode=false`, so
  commit new scripts with `git add --chmod=+x`.
- Setting the notification makes S3 publish an `s3:TestEvent` message. It happens on every LocalStack
  start; queue consumers must ignore it.
- LocalStack runs without persistence: a restart wipes objects and messages and the scripts recreate
  empty resources. To re-apply a changed script, `docker compose restart localstack`.
- LocalStack returns queue URLs as `http://sqs.<region>.localhost.localstack.cloud:4566/...`. The
  project uses the equivalent `http://<host>:4566/000000000000/<queue>`, which needs no external DNS.
- Two S3 endpoints: `AWS_ENDPOINT_URL` is what the app reaches (`localstack:4566` inside Compose) and
  `S3_PUBLIC_ENDPOINT_URL` is what the browser reaches (`localhost:4566`). `S3PresignedUrlFactory`
  signs URLs with a client on the public endpoint and does `HEAD` with the internal one. Signing
  makes no network call, so the public client never needs to reach S3.
- `createS3Client` (`packages/shared/src/aws/s3.ts`) sets
  `requestChecksumCalculation: 'WHEN_REQUIRED'` — without this, AWS SDK v3
  attaches a mandatory CRC32 checksum to presigned URLs that LocalStack (and a
  plain browser/curl `PUT`) rejects with `400 InvalidRequest`. Don't remove this setting.

## Docker

- Build context is always the monorepo root: `docker build -f apps/api/Dockerfile -t 4frames-api .`
- The production image installs with `--ignore-scripts` (the root `postinstall` needs sources that
  are copied later), builds `shared` and `api`, then `pnpm deploy --prod --legacy` copies only the
  API with production dependencies. It runs `node dist/main.js` as the `node` user.
- `apps/api/dev.Dockerfile` backs the `migrate` and `api` Compose services. `docker-entrypoint.sh`
  installs dependencies, generates the Prisma Client, builds `shared` and then `exec "$@"` runs the
  service command. Each package's `node_modules` is an anonymous volume so host-installed modules
  never leak into the Linux container.

## Commands (run at the repo root)

```bash
pnpm install          # also generates the Prisma Client and builds @4frames/shared
pnpm dev:api          # builds shared, then ts-node-dev for the API (also dev:worker, dev:notifier)
pnpm dev:shared       # tsc --watch for packages/shared
pnpm build            # every package, in dependency order
pnpm type-check       # builds shared, then type-checks every package
pnpm lint             # eslint for the whole repo (lint:fix to autofix); also formats TS/JS via prettier
pnpm format           # prettier for md/json/yml (format:check to verify)
pnpm test             # jest in every package
pnpm --filter @4frames/api test   # a single package
pnpm db:migrate       # prisma migrate dev (packages/shared)
pnpm db:deploy        # prisma migrate deploy
pnpm db:generate      # prisma generate
pnpm db:seed          # seed test users
docker compose up -d --build                             # full stack, API in a container
docker compose up -d postgres redis mailpit localstack   # infra only, apps via pnpm dev:*
```

A Husky `pre-commit` hook runs lint-staged on staged files: `eslint --fix` for `*.ts`/`*.js` and
`prettier --write` for `*.md`/`*.json`/`*.yml`/`*.yaml` (config in the root `package.json`). Files you
create or edit should already pass `pnpm lint` and `pnpm format:check`, so the hook has nothing to rewrite.

Run `pnpm lint`, `pnpm type-check`, `pnpm test` and `pnpm build` before considering any change done.
For endpoints touching S3, do a real curl smoke test against LocalStack
(login → create → PUT → complete → get-status) — unit test coverage on
`video-job.service.ts`/`s3-presigned-url.service.ts` is currently low (they're
thin Prisma/AWS SDK adapters), so a manual end-to-end check is the only thing
that catches integration issues like the CORS/checksum gaps above.

## Known gaps (per ADR-001)

- No worker logic, no ffmpeg processing. Every confirmed upload already lands as a message
  in `4frames-video-uploads`, but `apps/worker` and `apps/notifier` only start, log and shut
  down gracefully. A job confirmed via `POST /videos/:jobId/complete` reaches `QUEUED` and
  stays there — nothing consumes the queue yet.
- `.env.example` already lists worker and notifier settings (`SQS_*`, `REDIS_URL`, `FRAME_*`,
  `SMTP_*`, `MAIL_FROM`, `WEB_APP_URL`) that no app reads yet.
- No `GET /videos` (list jobs for the current user).
- No `GET /videos/:jobId/download` (presigned/CloudFront download URL when
  `DONE`).
- `video_jobs` already has `failure_reason`, `zip_key`, `frame_count`, `duration_seconds`,
  `notified_at` and `correlation_id`, but nothing writes them yet (worker, notifier and
  correlation logging come later). Only `failure_reason` is exposed, in `GET /videos/:jobId`.
- `POST /auth` vs. the ADR's documented `POST /auth/login` — the route name
  never got reconciled with the ADR text; not a functional issue, just a doc
  mismatch to be aware of.
