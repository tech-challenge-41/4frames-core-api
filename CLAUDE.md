# 4frames-core-api — Architecture Guide

pnpm monorepo with the 4Frames backend: the API, the processing worker, the email notifier
and a shared package. Read this before adding or changing any endpoint or package.

## Monorepo layout

```
apps/
  api/          @4frames/api       Express 5 REST API (hexagonal, see "Layers" below) + src/cron: abandoned-upload expiration entrypoint
  worker/       @4frames/worker    SQS consumer + ffmpeg: frames, zip, job status and progress (see "Worker" below)
  notifier/     @4frames/notifier  Redis `jobs.events` subscriber, SMTP e-mail (Pug templates), recovery sweep, /healthz
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
      health/     HealthServer: GET /healthz for the worker and notifier liveness probes
      generated/  Prisma Client output (gitignored, created by `pnpm db:generate`)
infra/localstack/init/             LocalStack bootstrap scripts
infra/k8s/                         Kustomize: base (api + HPA, worker + KEDA, notifier, web, Ingress /api and /, migrate Job, expire-uploads CronJob), overlays local/ci, kind-config.yaml
scripts/k8s-local.sh               the one command for the full stack: `up` (Compose infra, Kind, images incl. web from ../4frames-web-app, metrics-server, ingress-nginx, KEDA, migrate Job, overlay local, check through the Ingress), `down [--all]`
.github/workflows/                 ci.yml (test→lint→type-check→k8s→build) + cd.yml (release-* → GHCR + Kind smoke)
docs/adr/                          architecture decisions: ADR-001 (PDF, AWS design) + ADR-002 (local run, monorepo, UUID)
tsconfig.base.json                 compiler options shared by every package
eslint.config.js, .prettierrc.js   one lint config for the whole repo
docker-compose.yml, .env           one Compose file and one .env at the root
```

### Shared package rules

- Put code in `packages/shared` only when two or more apps need it, or when it is a contract
  between apps (S3 keys, Redis channels, event payloads, statuses). App-specific code stays in
  the app. No Express, HTTP or request-scoped code in `shared`.
- Import through subpaths, never deep paths: `@4frames/shared/prisma`, `/env`, `/logger`,
  `/jobs`, `/aws`, `/redis`, `/process`, `/health`. The root `@4frames/shared` only re-exports the
  light modules (env, jobs, logger, process, health). Prisma, AWS and Redis stay behind subpaths so importing
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

Follow the exact shape of the `video` aggregate — `create-video-job`,
`complete-video-job`, `cancel-video-job`, `get-video-job-status`,
`get-video-job-download-url`, `list-video-jobs`, and `get-video-job-events` (SSE,
see its own note below) — don't invent a new convention. All paths below are
relative to `apps/api/src`.

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
   route, not one per aggregate — video has seven separate controllers, not one
   `VideoController` with multiple methods. The one exception is
   `GetVideoJobEventsController` (SSE): it still implements `IController`, but its
   `handle()` keeps the connection open and resolves only when the stream ends —
   see the comment at the top of that file before copying its shape for a
   non-streaming endpoint.
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

## Real-time progress (SSE)

`GET /videos/:jobId/events` streams job progress as it happens, instead of the
frontend having to poll `GET /videos/:jobId`. It is fed by the same Redis Pub/Sub
channel the worker already publishes to (see "Worker" below) — the API adds no new
producer, only a subscriber.

- `RedisJobEventSubscriberService` (`infra/services/`) opens one **dedicated**
  Redis connection per SSE connection via `createRedisClient()` — never the
  request-scoped or a shared client, because a connection in subscriber mode stops
  accepting other commands. It reads the current value of `progress:{jobId}`
  before subscribing (so a client connecting mid-processing doesn't wait for the
  next throttled publish) and closes the connection when the HTTP request/response
  closes.
- Progress percentages come straight from ffmpeg's own `-progress pipe:1` output
  (parsed against the real video duration from `ffprobe`), not a fixed timer or an
  estimate — see "Worker" below. A short video can look like it "jumps" because the
  0–85% range is throttled to at most one update per second, and 85→90→99→100 are
  fixed checkpoints for zip/upload/done, not a continuous measurement of those
  steps.
- Authorization runs once, via `GetVideoJobStatusUseCase`, **before** `res.writeHead`
  — a `DomainError` there is still translated normally by `controllerWrapper`.
  After the stream starts, an error is written as an SSE `{ type: 'error', message }`
  event and the stream ends; there's no way to send an HTTP error status anymore.
- `EventSource` in the browser can't send custom headers, so `Authorization: Bearer`
  doesn't reach this route. `sseAuthMiddleware` (not `authMiddleware`) accepts the
  token via `?token=` as a fallback, restricted to this one route — an
  `Authorization` header is still tried first (for curl/tests). A token in a query
  string can leak into access logs and proxies; don't reuse this middleware
  elsewhere. The API access log (`infra/logging/pino/http-request-logger.middleware.ts`)
  masks `?token=` and the `Authorization`/`Cookie` headers, and the local ingress-nginx
  logs the path without the query string. Keep both if you touch request logging.
- The stream ends itself on a terminal event (`job.done`/`job.failed`); a 15s
  heartbeat comment (`: heartbeat\n\n`) keeps proxies from closing an idle
  connection meanwhile. Headers are flushed right after `writeHead`, so the
  `EventSource` opens before the first event.
- Every open stream registers in `SseStreamRegistry` (`infra/http/shutdown/`). On
  SIGTERM, `HttpShutdown` ends them with `retry: 1000` so the `EventSource`
  reconnects to a replica that is still up; otherwise `server.close()` would wait
  for them forever. A new streaming endpoint must register the same way.
- The frontend keeps `GET /videos/:jobId` polling running in parallel as the
  source of truth for status; SSE only adds the live percentage during
  `PROCESSING`. `EventSource` reconnects on its own, so a dropped SSE connection
  is not treated as fatal on either side.
- `GET /videos` and `GET /videos/:jobId` also carry the last stored percentage as an
  optional `progress`, read through `IJobProgressReader` (`RedisJobProgressReaderService`:
  one `MGET progress:*` per request). Only `PROCESSING` jobs get it — the worker leaves
  `100` stored for an hour after `DONE`. It is best-effort: if Redis fails, the reader
  returns an empty map and the response goes out without `progress`.

## Abandoned-upload expiration (`apps/api/src/cron`)

- `ExpireAbandonedUploadsUseCase` marks `UPLOAD_PENDING` jobs created before
  `now - (UPLOAD_URL_TTL_SECONDS + 60 s)` as `EXPIRED` with one conditional `updateMany` (status in the
  `WHERE`, so a concurrent `complete` wins and reruns are harmless), and counts `PROCESSING` jobs with no
  write for 15 min (log only; the worker writes to Postgres only on transitions, so progress does not
  refresh `updated_at`).
- `cron/main.ts` is a separate entrypoint in the API image, built without the `Container` (it only needs
  Postgres): `--once` for one pass (the `expire-uploads` CronJob, every minute, `concurrencyPolicy: Forbid`,
  removed from `overlays/ci`), or a 60 s loop with graceful shutdown for development (`ExpirationRunner`).
  It must never run inside the API replicas.

## Readiness and graceful shutdown (API)

- `GET /health-check` is liveness: the process is up, nothing else. `GET /ready` is readiness:
  `CheckReadinessUseCase` runs every `IDependencyHealthIndicator` (`PostgresHealthService`:
  `SELECT 1`; `RedisHealthService`: `PING`) in parallel, 2 s each, and the controller answers 200 or
  503 with `{ status, checks }`. A new hard dependency of the API gets an indicator registered in
  `use-case.dependency.ts`. Both probe paths are left out of the access log.
- The API has one Redis command connection (`createRedisCommandClient`, registered as
  `REDIS_COMMAND_CLIENT_KEY`), shared by the `/ready` PING and the progress MGET, with one retry and
  a 1 s command timeout. SSE streams never use it: each opens its own subscriber connection.
- `main.ts` registers `registerGracefulShutdown` (`@4frames/shared/process`) with
  `API_SHUTDOWN_TIMEOUT_SECONDS` (default 20). The API is PID 1 in its container: without a handler
  the kernel ignores SIGTERM and the pod only dies on SIGKILL. `HttpShutdown.run` stops accepting
  connections, answers with `Connection: close`, ends the SSE streams, waits for in-flight requests
  (closing keep-alive connections as they go idle) until the drain deadline, then closes Redis and
  Prisma. The cluster adds a 5 s `preStop` sleep and `terminationGracePeriodSeconds: 35`.
- Anything the API keeps open for its whole life (a client, a pool) must be closed in the
  `closeResources` callback in `http-initialize.ts`; otherwise `process.exit` just drops it.

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

## Worker (`apps/worker`)

Not hexagonal like the API, but the same idea: `processing/process-video-job.usecase.ts` orchestrates and
depends only on the interfaces in `processing/ports.ts`; adapters live next to it.

```
config/worker-env.ts          zod schema for every worker variable (defaults: FRAME_FPS=1, FRAME_FORMAT=png, WORKER_MAX_PARALLEL_JOBS=2)
consumer/sqs-consumer.ts      generic SQS loop: long polling, up to maxParallelJobs handlers in parallel (Promises), visibility heartbeat, stop()
consumer/video-upload-handler.ts  S3 event → use case (ignores s3:TestEvent, deletes malformed messages)
consumer/dlq-handler.ts       dead-lettered message → FAILED "Falha após 3 tentativas" + job.failed
processing/                   use case, ports, InvalidVideoError + FAILURE_REASONS, source key parsing
ffmpeg/                       run-process (spawn), ffprobe validation, frame extraction with -progress
storage/ zip/ repo/ progress/ S3 (lib-storage), archiver, Prisma, Redis publisher
                              (/healthz comes from @4frames/shared/health)
```

- Error classification is the core rule. `InvalidVideoError` (the video's fault) → `FAILED` with a Portuguese,
  user-facing `failure_reason` and the message is deleted. Any other error is transient: rethrow it, the
  consumer makes the message visible again in 60 s, and after 3 receives SQS moves it to the DLQ. A process
  killed by a signal or timeout, or ffmpeg failing for lack of disk/memory, is transient, not invalid.
- Write order (ADR-001 §2.3): S3 artifacts → status in Postgres → Redis event. Redis publishing is
  best-effort (logged, never rethrown): the durable status is already saved.
- Status transitions are conditional `updateMany` calls. `markProcessing` accepts `QUEUED` **and**
  `PROCESSING`, so a message that reappears after a worker crash resumes the job.
- The S3 event fires at the end of the PUT, before the front calls `complete`. A job still in
  `UPLOAD_PENDING` is polled for up to 30 s, then the message is returned to the queue.
- `stop()` aborts the long poll and waits for the current message; `isAlive()` stays true while that job
  finishes, so a liveness probe never kills a pod during graceful shutdown.
- **Parallel jobs**: one `SqsConsumer` on the uploads queue runs up to `WORKER_MAX_PARALLEL_JOBS` handlers
  concurrently on the Node event loop (default **2**, max 32; `WORKER_CONCURRENCY` is a deprecated alias).
  Each job spawns its own ffmpeg; temp files are isolated under `WORKER_TMP_DIR/{jobId}`. In Compose, tune
  `WORKER_MAX_PARALLEL_JOBS` and/or `docker compose up --scale worker=N`. Production scaling is still KEDA réplicas per ADR-002.
- Tests: unit specs next to the code (fake runner for ffmpeg, fake SQS client). `test/integration` runs real
  ffmpeg on `test/fixtures` and skips when ffmpeg is not in PATH (run them inside the worker container).

## Docker

- Build context is always the monorepo root: `docker build -f apps/api/Dockerfile -t 4frames-api .`
- The production image installs with `--ignore-scripts` (the root `postinstall` needs sources that
  are copied later), builds `shared` and `api`, then `pnpm deploy --prod --legacy` copies only the
  API with production dependencies. It runs `node dist/main.js` as the `node` user.
- `apps/api/dev.Dockerfile` backs the `migrate` and `api` Compose services. `docker-entrypoint.sh`
  installs dependencies, generates the Prisma Client, builds `shared` and then `exec "$@"` runs the
  service command. Each package's `node_modules` is an anonymous volume so host-installed modules
  never leak into the Linux container.
- `apps/worker/dev.Dockerfile` is the same base plus `ffmpeg`, with the same entrypoint. The `worker` service
  sets `SKIP_SHARED_BUILD=1` (migrate already built `shared`; api and worker start together),
  `WORKER_MAX_PARALLEL_JOBS` (default 2) for parallel video jobs in one container, and runs the compiled worker
  with `exec node` under `init: true`, not `ts-node-dev`: ts-node-dev exits on SIGTERM without waiting for its
  child, which would break graceful shutdown. `stop_grace_period` is 10 min.
- The `notifier` service uses the same dev image/entrypoint as `api`, `pnpm --filter @4frames/notifier dev`,
  `SKIP_SHARED_BUILD=1`, SMTP pointed at the Compose `mailpit`, starts with `docker compose up` alongside api/worker.
- `apps/worker/Dockerfile` (production) installs `ffmpeg`, runs `node dist/main.js` as `node` and exposes 9100.
- `apps/notifier/Dockerfile` (production) runs `node dist/main.js` as `node` and exposes 9100 (`/healthz`, used by
  the `httpGet` probes in `infra/k8s/base/notifier-deployment.yaml`).
- `packages/shared/Dockerfile` builds `4frames-migrate`, the image of the `migrate` Job in the cluster
  (`prisma migrate deploy` + seed). It keeps the shared devDependencies (Prisma CLI, `tsx`, `bcrypt`) and the
  TypeScript sources that `prisma.config.ts` and the seed import, which the app images leave out. The Prisma
  schema engine is installed at build time (`pnpm rebuild`), so the Job never downloads it.

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
pnpm --filter @4frames/api expire --once   # one pass of the abandoned-upload expiration (no --once: every minute)
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

## What's implemented (video job lifecycle, per ADR-001 §2.2)

The full lifecycle of a job is implemented and tested end to end (many jobs per user and parallel
processing via SQS + multiple worker consumers/réplicas):
`POST /videos` (create + presigned upload URL) → direct browser `PUT` to S3 →
`POST /videos/:jobId/complete` (confirm + `QUEUED`) →
`POST /videos/:jobId/cancel` (cancel while `UPLOAD_PENDING`/`QUEUED`, reuses the
`EXPIRED` status — see the comment on `VideoJobService.cancelIfPending`, no
separate `CANCELLED` status was added) → S3 event → SQS → `apps/worker` (ffmpeg
frames + zip, `PROCESSING` → `DONE`/`FAILED`) →
`GET /videos/:jobId` (status polling) and `GET /videos/:jobId/events` (SSE live
progress) → `GET /videos/:jobId/download` (presigned S3 `GET`, only when `DONE`)
→ `GET /videos` (paginated list of the current user's jobs, `offset`/`limit`,
ordered by `created_at desc`).

## Known gaps

**Application-level (per ADR-001):**

- `correlation_id` on `video_jobs` is still unused for correlated logging across
  api/worker/notifier (field exists; propagation not wired end-to-end).
- `POST /auth` vs. the ADR's documented `POST /auth/login` — the route name
  never got reconciled with the ADR text; not a functional issue, just a doc
  mismatch to be aware of.

**Infrastructure-level (per ADR-002):**

- The local Kind cluster (`scripts/k8s-local.sh`) serves the front and the API through ingress-nginx on
  http://localhost:8080 (`/` → the `web` nginx image built from the sibling `4frames-web-app` clone,
  `/api` → API with the prefix stripped, in a separate Ingress because of its `rewrite-target`), with
  metrics-server for the API HPA, KEDA on the worker and migrations + seed as the `migrate` Job. The CD
  Kind (`overlays/ci`) drops the `web` Deployment: that image belongs to the web-app repo.
- No Prometheus/Grafana; no metrics exported beyond what's in application logs.
