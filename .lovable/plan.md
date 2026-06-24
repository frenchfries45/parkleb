
## Part A — Fix build errors first

These are blocking the build. Most are unrelated to the schema change; I'll fix them in one pass.

### A1. Missing `build:dev` script
`package.json` only has `build`. Hosting expects `build:dev`. Add:
```json
"build:dev": "vite build --mode development"
```

### A2. shadcn `ui` library-version mismatches
Three files use old APIs that no longer match the installed libraries:

- **`src/components/ui/calendar.tsx`** — `react-day-picker` v9 removed `IconLeft`/`IconRight`. Replace with the new `Chevron` component slot.
- **`src/components/ui/chart.tsx`** — `recharts` v3 changed the Tooltip/Legend payload typing. Loosen the prop types on `ChartTooltipContent` and `ChartLegendContent` (the standard shadcn v3-compatible version) so `payload`, `label`, etc. are typed correctly.
- **`src/components/ui/resizable.tsx`** — `react-resizable-panels` no longer has a default export. Switch to named imports: `import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels"`.

### A3. `src/hooks/usePendingMessages.ts` references a non-existent table
The `pending_messages` table is referenced in code but was never created (only an orphan migration file `supabase/migrations/20260228000001_pending_messages.sql` exists, never applied — and `BackendAdmin.tsx` also uses it).

I'll confirm with you which path you want **before** touching it:

- **Option A (recommended):** apply the existing `pending_messages` migration so the table actually exists and types regenerate. Code then compiles as-is.
- **Option B:** delete `usePendingMessages.ts`, the orphan migration, and the section of `BackendAdmin.tsx` that uses it — if the pending-messages feature isn't wanted.

I'll ask before doing either.

---

## Part B — Merge `user_roles` + `allowed_usernames` into `profiles`

You accepted the privilege-escalation tradeoff, so I'll mitigate it with RLS rather than ignore it.

### B1. New `profiles` shape (migration)

Keep `profiles` and add:
- `role app_role NOT NULL DEFAULT 'employee'` — moved from `user_roles`.
- `allowlisted_username text UNIQUE` — replaces the `allowed_usernames` table. Pre-seeded rows have `user_id = NULL` (an admin-created invite); when a user signs up, their auth row's id is written into `user_id` to "claim" the invite.

To allow `user_id` to be temporarily null for un-claimed invites, `user_id` becomes nullable but `UNIQUE`.

### B2. Privilege-escalation guard (critical)

Because `role` now lives on a row the user can otherwise edit, RLS must forbid users from changing their own `role`:

```sql
-- Users can update their own profile EXCEPT role
CREATE POLICY "users update own profile (not role)"
ON public.profiles FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id AND role = (SELECT role FROM public.profiles WHERE user_id = auth.uid()));

-- Only admins can change roles
CREATE POLICY "admins update any profile"
ON public.profiles FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));
```

`has_role()` is rewritten to read from `profiles` instead of `user_roles`, still `SECURITY DEFINER` to avoid recursion.

### B3. Update existing DB functions
- `has_role(_user_id, _role)` → `SELECT role = _role FROM profiles WHERE user_id = _user_id`.
- `is_username_allowed(name)` → `SELECT EXISTS(SELECT 1 FROM profiles WHERE allowlisted_username = lower(name) AND user_id IS NULL)`.
- `claim_allowed_username(name)` → `UPDATE profiles SET user_id = auth.uid() WHERE allowlisted_username = lower(name) AND user_id IS NULL`.
- `handle_new_user()` trigger → if a matching `allowlisted_username` row exists, update it with the new `user_id`; otherwise insert a new profile row with default role `employee`.

### B4. Data migration
1. Add the new columns to `profiles`.
2. Backfill `profiles.role` from `user_roles` (one role per user — if a user has multiple, prefer `admin`).
3. Backfill `profiles.allowlisted_username` for any unclaimed `allowed_usernames` rows (insert new profile rows with `user_id = NULL`).
4. Drop `user_roles` and `allowed_usernames` tables.

### B5. Frontend code updates
After types regenerate, update:
- `useUserRole`/anywhere reading `user_roles` → read `profiles.role`.
- `Manage Accounts` / signup flow → query `profiles` instead of `allowed_usernames`.
- Any insert into `user_roles` or `allowed_usernames` → insert/update `profiles`.

I'll grep for `user_roles` and `allowed_usernames` references and update each call site.

---

## Order of execution
1. Fix `package.json` + the three `ui/` files (unblocks build).
2. Ask you: keep or drop `pending_messages`?
3. Run the schema-merge migration (you approve it).
4. Update all frontend call sites after types regenerate.

## Question before I start
For `pending_messages` — **apply the existing migration (keep the feature)** or **delete the code (drop the feature)**?
