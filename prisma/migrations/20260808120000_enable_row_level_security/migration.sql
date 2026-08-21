-- ============================================================================
-- Row-Level Security (RLS) — schema for the multi-tenant isolation backstop.
--
-- Roles are created NOLOGIN here (structural only) — passwords are set out
-- of band by scripts/provision-runtime-roles.mjs (never committed to a
-- migration file), and runtime apps only start connecting as these roles
-- once cut over (see docker-compose.yml / apps/admin-api main.ts for the
-- app_admin_runtime remap). Application-side tenant-context propagation
-- (AsyncLocalStorage + a Proxy over PrismaBusinessService's tenant-scoped
-- delegates — NOT a Prisma Client Extension, whose query hooks were found
-- not to preserve AsyncLocalStorage context in this stack) lives in
-- libs/prisma-business/src/prisma-business.service.ts and tenant-context.ts.
--
-- Design rationale: app-level `orgId` filtering is easy to forget (see
-- libs/memberships/.../memberships.repository.ts#findById/update and
-- libs/jobs/.../job.repository.ts#markProcessing/markDone/markFailed/delete,
-- which already filter by `id` alone). RLS makes that class of bug
-- unexploitable at the database layer, independent of application code.
--
-- NULLIF(current_setting(...), '')::uuid, not a bare ::uuid cast: a custom
-- GUC placeholder that has never been SET on the current physical
-- connection can read back as '' (empty string) rather than NULL once
-- Postgres has registered it as a known placeholder name — casting ''
-- directly to uuid raises "invalid input syntax for type uuid", crashing
-- the query instead of failing closed. NULLIF folds '' to NULL first, so
-- the cast is always either a real UUID or NULL (org_id = NULL is safely
-- false, not an error).
-- ============================================================================

-- ── Roles ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;

  -- admin-api has its own trust boundary (AdminJwtAuthGuard + a dedicated
  -- Auth0 app) and legitimately needs cross-org reads (e.g.
  -- AdminOrganizationsService.findAll()). BYPASSRLS formalizes that as an
  -- explicit, auditable database-level grant rather than an implicit gap.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_admin_runtime') THEN
    CREATE ROLE app_admin_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- ── Database / schema grants ─────────────────────────────────────────────────

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_admin_runtime', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO app_runtime, app_admin_runtime;
GRANT USAGE ON SCHEMA app_audit TO app_runtime, app_admin_runtime;

-- ── Table grants ─────────────────────────────────────────────────────────────
-- Both roles need identical table-level privileges: BYPASSRLS on
-- app_admin_runtime only skips row-visibility checks, it does not imply
-- SELECT/INSERT/UPDATE/DELETE — those still require an explicit GRANT.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.users,
  public.organizations,
  public.memberships,
  public.files,
  public.jobs,
  public.org_exports,
  public.notifications,
  public.entitlement_overrides,
  public.billing_events,
  public.subscription_snapshots,
  public.events,
  public.event_attendees,
  public.event_occurrence_attendees,
  public.event_exceptions,
  app_audit.activity_logs
TO app_runtime, app_admin_runtime;

-- ── Row-Level Security ───────────────────────────────────────────────────────
-- Fail-closed by construction: current_setting('app.current_org_id', true)
-- returns NULL when the tenant context has not been propagated for the
-- current transaction (e.g. a bug in the AsyncLocalStorage/Prisma-extension
-- plumbing), and `org_id = NULL` is never true in SQL — so a missing
-- context denies access rather than granting it.
--
-- FORCE ROW LEVEL SECURITY is intentionally omitted: it only matters when
-- the querying role is also the table owner, which app_runtime and
-- app_admin_runtime never are — the migration role retains ownership of
-- every table.

-- Direct org_id column, tenant-scoped tables.
--
-- USING also allows a row through when it belongs to the current user
-- (app.current_user_id — see tenant-context.ts), on top of the usual
-- org-context match. This is what lets a user list every org they belong
-- to (GET /organizations, cross-org by design) without needing a single
-- org context — OrganizationsRepository#findByUserId queries memberships
-- by userId alone. WITH CHECK stays org-context-only: a user must never be
-- able to INSERT/UPDATE a membership row just by having their own user id
-- match — that would let them self-grant membership in an arbitrary org.
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.memberships
  USING (
    org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.files
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- jobs.org_id and org_exports.org_id are stored as plain TEXT (no @db.Uuid
-- on their Prisma fields, unlike every other org_id column) — compare as
-- text, not uuid, or Postgres raises "operator does not exist: text = uuid".
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.jobs
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE public.org_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.org_exports
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- Also allows access by user_id match, in both USING and WITH CHECK: several
-- notification routes (mark-as-read, unread-count, delete) are scoped only
-- to the authenticated user and have no org context at all (no @OrgScoped()
-- — see apps/api/src/app/notifications/notifications.controller.ts).
-- Unlike memberships/organizations, allowing WITH CHECK via user_id here
-- doesn't enable self-escalation: a user can only ever touch rows that
-- already belong to them (their own notifications), not grant themselves
-- access to anything new.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.notifications
  USING (
    org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK (
    org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

ALTER TABLE public.entitlement_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.entitlement_overrides
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- billing_events.org_id is nullable (platform-level Stripe events not tied
-- to a single org, e.g. the public webhook endpoint recording an event
-- whose Stripe object carries no orgId metadata). Both USING and WITH CHECK
-- must explicitly allow `org_id IS NULL` — NULL is never equal to anything
-- in SQL, so a bare `org_id = <context>` check would make it *impossible*
-- for app_runtime to ever write OR read back such a row. USING matters
-- here even for INSERT: Prisma's create() always does INSERT ... RETURNING
-- *, and Postgres evaluates USING (not just WITH CHECK) against the
-- RETURNING projection — omitting the NULL exception from USING made
-- inserting a legitimate NULL-org row fail even though WITH CHECK alone
-- allowed it, because Postgres couldn't return the row it had just
-- accepted. This does mean NULL-org rows are visible to every org context
-- (and to no context) via app_runtime — acceptable since they don't belong
-- to any tenant, so nothing tenant-specific leaks.
-- USING also allows app.system_lookup (see tenant-context.ts#runAsSystemLookup):
-- the webhook's idempotency check (findBillingEvent, keyed by stripeEventId,
-- not org) must see a *previously processed* event even when that event's
-- own org_id was resolved and stored — otherwise a retry with no ambient
-- context would see "not found" and reprocess an already-handled event,
-- breaking the "duplicate events are safely ignored" guarantee.
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.billing_events
  USING (
    org_id IS NULL
    OR org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    OR current_setting('app.system_lookup', true) = 'true'
  )
  WITH CHECK (
    org_id IS NULL
    OR org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  );

ALTER TABLE public.subscription_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.subscription_snapshots
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.events
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE app_audit.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app_audit.activity_logs
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Tenant root: policy keyed on the organization's own id rather than an
-- org_id column.
--
-- USING also allows a row through when:
--  (a) the current user has a membership in it (mirrors the memberships
--      policy's user_id exception above, needed for the same
--      GET /organizations use case: Prisma resolves membership.organization
--      via a join/second query, which needs to see the org row too); or
--  (b) app.system_lookup is set (see tenant-context.ts#runAsSystemLookup) —
--      for lookups that have no org or user identity to key off yet, e.g.
--      the Stripe webhook resolving which org a stripeCustomerId belongs
--      to before anything else about the request is known.
-- WITH CHECK stays org-context-only for the same self-escalation reason as
-- memberships — system_lookup and the membership check are read-only
-- escape hatches, never write ones.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.organizations
  USING (
    id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.org_id = organizations.id
        AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
    OR current_setting('app.system_lookup', true) = 'true'
  )
  WITH CHECK (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Child tables with no org_id column of their own: scope through the
-- parent `events` row via its event_id FK.
ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.event_attendees
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_attendees.event_id
      AND e.org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_attendees.event_id
      AND e.org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  ));

ALTER TABLE public.event_occurrence_attendees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.event_occurrence_attendees
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_occurrence_attendees.event_id
      AND e.org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_occurrence_attendees.event_id
      AND e.org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  ));

ALTER TABLE public.event_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.event_exceptions
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_exceptions.event_id
      AND e.org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_exceptions.event_id
      AND e.org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  ));

-- `users` is a global identity table, not tenant-scoped (Membership is the
-- join to Organization) — intentionally no RLS policy here.
