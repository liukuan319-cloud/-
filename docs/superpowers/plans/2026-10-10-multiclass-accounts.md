# Banshu multi-class account upgrade implementation plan

> **For agentic workers:** Execute inline in the current task. Keep each stage deployable and verify before touching the production database.

**Goal:** Replace invite-code login with password accounts, add faculty/cadre/student permissions, seed the specified class, and extend confirmed AI actions without crossing class boundaries.

**Architecture:** Preserve the existing per-class D1 schema. Add an additive migration and scoped business APIs; use PBKDF2 password hashes and the existing session cookie. AI prepares typed actions, and the shared confirmation endpoint rechecks identity, role, class and source version before any mutation.

**Tech Stack:** React, TypeScript, Hono, Cloudflare Workers/D1, Vitest.

**Spec:** User-provided attachment `5dccdc5a-afa9-4a9d-bfa8-85745ef3104f/已粘贴的文本.txt`.

## Global Constraints

- One account belongs to one class; all reads and writes use the authenticated class ID.
- Only one faculty member per class; cadres cannot edit roles or class settings.
- Student numbers never enter AI context or public member responses.
- AI writes require a user-visible confirmation card and audit record.
- Do not commit plaintext passwords or model secrets.
- Production reset only after backup and local verification; retain class, faculty, semester calendar, 50 students and week-7 schedule.

---

### Task 1: Migration and password authentication

**Files:** `migrations/0011_accounts.sql`, `server/auth.ts`, `server/index.ts`, `server/types.ts`, `tests/backend.test.ts`

- [ ] Add account columns, per-class faculty constraint and personal tasks table.
- [ ] Add PBKDF2 helpers, failed-login lockout, login, activation and password-change endpoints.
- [ ] Replace invite-code membership login; verify existing data stays available after migration.
- [ ] Test activation, wrong code, lockout and cross-class login.

### Task 2: Role administration and class settings

**Files:** `server/member-admin.ts`, `server/member-import.ts`, `server/index.ts`, `server/business.ts`, `tests/backend.test.ts`

- [ ] Enforce faculty/cadre/student matrix at every write boundary.
- [ ] Add faculty transfer, reset-password, rename, rotate-code and class reset APIs.
- [ ] Test class isolation, cadre scope and session revocation.

### Task 3: Specified class initialization

**Files:** `server/initialization.ts`, `server/schedule.ts`, `server/calendar.ts`, `migrations/0012_schedule_detail.sql`, `tests/backend.test.ts`

- [ ] Seed 50 unactivated students by number, the week-7 course records and semester events idempotently.
- [ ] Add schedule date/week, teacher and non-current-week fields; expose them to page and AI.
- [ ] Test exact roster/course/event counts and week calculations.

### Task 4: AI confirmed actions and personal tasks

**Files:** `server/ai.ts`, `server/business.ts`, `server/index.ts`, `tests/ai.test.ts`

- [ ] Implement typed prepare-only tools for permitted role actions and daily personal tasks.
- [ ] Route all confirmation to audited business functions with fresh permission checks.
- [ ] Test faculty/cadre/student positive and forbidden operations.

### Task 5: Frontend account and management flows

**Files:** `src/App.tsx`, `src/ExpandedPages.tsx`, `src/api.ts`, `src/styles.css`

- [ ] Build login, activation and class creation forms.
- [ ] Show faculty/cadre/student navigation, masked numbers, role and password controls.
- [ ] Show personal tasks, week-7 schedule and calendar data; confirm AI actions in UI.
- [ ] Check desktop and mobile layouts.

### Task 6: Verification and release

**Files:** `docs/implementation.md`, `docs/testing.md`

- [ ] Run `pnpm build`, `pnpm test`, `pnpm check:server`, and focused API/browser flows.
- [ ] Export production D1 backup, inspect target class, apply migrations and seed only that class.
- [ ] Reset target class after verifying backup, then inspect row counts and class isolation.
- [ ] Push GitHub `main`, deploy Worker and check `/api/health` and versioned assets.
