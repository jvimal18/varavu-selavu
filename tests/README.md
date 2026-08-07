# Test Layout

This directory is organized by **product capability**, not by technical
layer. Each test file is owned by the feature it protects. The end gate is
the feature/scenario matrix in [`TESTING_PLAN.md`](../TESTING_PLAN.md) — not
a line-coverage percentage.

## Layout

```
tests/
├── unit/                      # Genuinely cross-feature utilities
│   ├── money.test.ts
│   └── dates.test.ts
├── features/                  # One folder per product capability
│   ├── auth/
│   ├── accounts/
│   ├── transactions/
│   ├── categories/
│   ├── dashboard/
│   ├── budget/
│   ├── backup/
│   ├── security/
│   ├── migrations/
│   ├── pwa/
│   ├── preferences/
│   └── changelog/
├── integration/
│   └── runtime/               # Composition that no single feature owns
├── helpers/                   # Test utilities (Nuxt server, file DB, fixtures)
└── fixtures/                  # Immutable historical DBs, export snapshots
```

A feature folder may contain pure, DB, HTTP, mounted-UI, and tiny
production-preview browser tests as appropriate — **test storage location
does not dictate test level**.

## Naming rule

A test file represents one cohesive user-visible capability or invariant,
not necessarily one route. The name is `<capability>-<contract>.test.ts`,
e.g. `balance-math.test.ts`, `session-lifecycle.test.ts`,
`historical-upgrade.test.ts`. Avoid names that describe implementation
(`index.post.test.ts`, `account-api.test.ts`, `utils.test.ts`).

`describe` blocks name the user-facing feature and scenario, not the
production filename. A test name should be readable as a sentence in
the matrix: `rate-limiter accepts 20 requests per minute per IP and
rejects the 21st with 429 + retryAfter`.

## Test categories

| Category      | Stack                           | Boundary                            |
| ------------- | ------------------------------- | ----------------------------------- |
| Pure          | Node + Vitest                   | The function being tested           |
| DB / schema   | Node + better-sqlite3 + Drizzle | A tmp file DB, migrator, raw SQL    |
| HTTP          | Node + Nuxt test-utils          | Real Nuxt server, real Origin/Cookie|
| UI (mounted)  | Vue Test Utils + Nuxt test-utils | Behavior-heavy state machines      |
| Browser       | Production preview + Playwright | PWA, offline cache, app shell      |

DB/HTTP/UI tests use **file-backed SQLite** (never `:memory:`) so WAL
and the `useDb()` singleton behave as in production. Each test context
gets a unique `NUXT_DB_PATH`.

## Writing or changing a test

Per the TDD skill: **name the break, exercise the real thing, derive
expected values by hand**. Before writing a test body, name the
production change that would make it fail. If only an unrelated
implementation constant or a panic would fail it, it protects nothing.
Meaningful contractual constants are different: test the user-visible
behavior that depends on the constant.

## When the test count disagrees with the matrix

The matrix in `TESTING_PLAN.md` is the source of truth. If you add a
test, the row gains a test name. If you remove one, the row is
re-classified as `partial` or `missing`. A passing test count with an
open `missing` row is a failed gate — update the matrix in the same
change that touches the test.

## Anti-patterns

- **Migrating the latest schema, then deleting tables/indexes to fake an
  old DB.** Use the frozen historical fixture under `tests/fixtures/db/`.
- **Hand-rolled SQL in a test that mirrors a production query.** Call
  the production function; if it isn't exported, export it.
- **Calling a helper an "integration test".** A pure function test is
  pure. An integration claim requires a real boundary it purports to
  cover.
- **In-memory SQLite for app integration.** It hides WAL/singleton
  bugs that only appear in production.
- **Mocking only to be safe.** If the real method is fast, call it.
- **Line coverage as the gate.** Lines can execute while a user can
  still log in as the wrong user, lose paise, or restore an incomplete
  backup.
