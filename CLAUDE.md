# 4frames-core-api — Architecture Guide

Node.js + TypeScript API, Clean/Hexagonal architecture. Read this before adding or
changing any endpoint.

## Stack

- Express 5, Zod (validation), Prisma/PostgreSQL, JWT (jsonwebtoken + bcrypt)
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` for presigned upload URLs
- LocalStack (S3 only, for now) for local dev — see `infra/localstack/`
- Manual DI via a `Container` singleton (no framework like InversifyJS/tsyringe)
- Jest for tests

## Layers (strict, don't cross them)

```
src/
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
    db/core/prisma/                 schema, migrations, seeds
  dependencies/
    container.ts                    the DI Container class
    infra.dependency.ts             registers infra services
    use-case.dependency.ts          registers use cases (wires them to infra services)
    controller.dependency.ts        registers controllers (wires them to use cases)
```

Use cases only depend on `domain/ports` interfaces — never import Prisma, the AWS
SDK, or Express types into `application/`. Controllers only depend on
`IUseCase<TInput, TOutput>` — never call a service or Prisma directly from a
controller.

## Adding a new endpoint

Follow the exact shape of the `video` aggregate (`create-video-job`,
`complete-video-job`, `get-video-job-status`) — don't invent a new convention.

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
   Cover: happy path, not-found/wrong-owner (same error/response either way — see
   "Authorization" below), and any domain-specific invalid-state transitions.

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
- The S3 client (`infra/services/s3-presigned-url.factory.ts`) sets
  `requestChecksumCalculation: 'WHEN_REQUIRED'` — without this, AWS SDK v3
  attaches a mandatory CRC32 checksum to presigned URLs that LocalStack (and a
  plain browser/curl `PUT`) rejects with `400 InvalidRequest`. Don't remove this
  setting.
- If you change the bucket's init script after LocalStack is already running,
  re-apply it manually (`docker exec 4frames-localstack awslocal s3api ...`) or
  recreate the container — `ready.d` scripts only run once, on first boot.

## Commands

```bash
pnpm dev            # dev server (ts-node-dev)
pnpm test           # jest
pnpm exec jest --coverage
pnpm lint           # eslint (check project scripts for exact name)
pnpm db:migrate     # prisma migrate dev
pnpm db:generate    # prisma generate (needed after clone/pull if generated/ is gitignored)
pnpm db:seed        # seed test users
```

Run `pnpm lint`, type-check, and `pnpm test` before considering any change done.
For endpoints touching S3, do a real curl smoke test against LocalStack
(login → create → PUT → complete → get-status) — unit test coverage on
`video-job.service.ts`/`s3-presigned-url.service.ts` is currently low (they're
thin Prisma/AWS SDK adapters), so a manual end-to-end check is the only thing
that catches integration issues like the CORS/checksum gaps above.

## Known gaps (per ADR-001)

- No SQS, no worker, no ffmpeg processing. A job confirmed via
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
