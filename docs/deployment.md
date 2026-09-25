# Deployment

## Normal delivery

Feature branch → PR → required checks and review → preview when configured → human merge to protected main → main checks → forward Supabase migrations → Vercel's GitHub Deployment Check releases the matching production build to its domain. Vercel can build while main CI runs; automatic production aliasing waits for `Production database ready`.

Do not suppress main deployment or add a custom manual promotion pipeline. Agents do not merge or initiate production actions without explicit authorization. The owner connects GitHub/Vercel and enables main protection with the required aggregate check and review requirements.

Local development and CI pin Node 24.19.0 in .nvmrc. package.json allows Node 24.x because [Vercel manages minor and patch updates](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). The Vercel install command explicitly runs npm 11.11.0 before installing the lockfile; packageManager alone does not select npm without Corepack.

## Environments

Development/CI use disposable local Supabase. Previews use the already-configured Supabase nonproduction/preview branching integration with fictional data. Production uses its own project and real inventory.

The optional trusted-branch [preview staff fixture workflow](preview-staff-access.md) provisions a marked staff account only in verified GitHub-managed PR child branches after the matching Supabase deployment succeeds. It requires separate owner-managed `preview-access` environment secrets and does not run from PR code.

Record the preview branch and applied repository migration revision when certifying a schema-changing preview. Do not reuse a production database or create replacement hosted projects.

| Variable                                                  | Boundary                                                |
| --------------------------------------------------------- | ------------------------------------------------------- |
| NEXT_PUBLIC_SUPABASE_URL                                  | Environment-specific public backend URL                 |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY                      | Public key; RLS remains mandatory                       |
| APP_ORIGIN                                                | Optional server-only origin override                    |
| APP_ENV                                                   | Server-only environment label                           |
| SPEED_INSIGHTS_ENABLED                                    | Optional server-only explicit telemetry opt-in (`true`) |
| Supabase access token/project reference/database password | GitHub `production-database` environment only           |
| Service-role credential                                   | Owner administration/local fixtures only                |

Commit placeholders only. Public values are build inputs; do not reuse an artifact built for another backend. Never run migrations inside Next build.

### Private Speed Insights

The application includes pinned `@vercel/speed-insights@2.0.0` instrumentation in its protected layout. Collection is off unless `SPEED_INSIGHTS_ENABLED=true` and Vercel provides `VERCEL_ENV=preview` or `production`. Set this server-only variable separately for an approved Vercel environment; do not add it to local/CI or expose it through `NEXT_PUBLIC_`. This repository change does not enable Speed Insights in a hosted project or change its plan or billing. Check the project setting and a signed-in preview before claiming hosted telemetry works.

The application reports only exact static `/dashboard`, `/inventory`, `/locations`, `/room`, and `/labels` routes. Auth/token query or fragment parameters reject the whole event; ordinary search parameters are removed from accepted URLs. A queued event is dropped if the browser has since reached an auth, unknown, or token-bearing URL. Auth, scan, dynamic record, export and unknown routes are dropped. [Vercel's package guide](https://vercel.com/docs/speed-insights/package) describes `beforeSend`; its [privacy page](https://vercel.com/docs/speed-insights/privacy-policy) lists URL, route and element selector among event fields. [Current limits and pricing](https://vercel.com/docs/speed-insights/limits-and-pricing) distinguish the free tier from Speed Insights Plus; this work does not activate Plus.

## Auth provisioning

Keep the email/password provider enabled while disabling new-user signup and anonymous sign-in. Set custom SMTP before real invitations and apply the checked-in invite/recovery templates. Invitations do not grant data access until the owner creates an active viewer/staff membership.

Configuration editing is a separate, owner-granted membership capability. An owner must first verify the intended person's Auth UUID in the correct environment and read both records in the SQL editor (replace the placeholder; do not commit a real UUID):

```sql
select id, email, email_confirmed_at from auth.users
where id = '<verified-auth-uuid>'::uuid;
select user_id, display_name, role, active, can_manage_configuration
from public.app_members
where user_id = '<verified-auth-uuid>'::uuid;
```

Confirm that exactly one intended Auth user and one **active staff** membership match. Stop on a missing, inactive, viewer, or unexpected account; resolve membership identity and role separately with the owner before granting configuration access. In particular, never promote the shared preview staff fixture, every staff member, the first user, or an email domain. Only after that read-first check, the owner may grant the single capability and verify the returned row:

```sql
update public.app_members
set can_manage_configuration = true
where user_id = '<verified-auth-uuid>'::uuid
  and role = 'staff' and active = true
returning user_id, role, active, can_manage_configuration;
```

Require exactly one returned row; zero means no grant occurred and needs investigation. To revoke this capability without removing ordinary inventory access, the owner sets `can_manage_configuration=false` for the same verified UUID. Application clients have no direct membership-update grant and there is no self-grant route. A production maintainer grant is an owner action outside feature-branch validation.

Origin precedence is explicit APP_ORIGIN → VERCEL_BRANCH_URL → http://localhost:3000. The branch hostname is normalized to HTTPS with no trailing slash; commit-specific VERCEL_URL is not used. Enable access to [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables). Leave APP_ORIGIN unset in the Preview environment so every Git branch resolves automatically; remove any inherited localhost or production override there. Set APP_ORIGIN explicitly for the production custom domain and non-Vercel hosted deployments.

In the separate nonproduction Supabase project's Auth redirect allowlist, configure a Vercel preview wildcard once: `https://<project-slug>-git-*-<team-or-account-slug>.vercel.app/auth/confirm`. Replace the placeholders using the actual stable branch hostname and verify that it matches; do not include literal angle brackets. This scopes the wildcard to this project's branch previews and the exact callback path. Supabase supports [preview redirect wildcards](https://supabase.com/docs/guides/auth/redirect-urls). Keep production's Site URL and redirect allowlist exact (for example, `https://inventory.example.com` and `https://inventory.example.com/auth/confirm`); do not add preview wildcards to the production project.

Templates honor the requested full /auth/confirm callback and fall back to Site URL + /auth/confirm when no override is supplied. Use an origin without a trailing slash for Site URL. When inviting into a preview explicitly, supply its stable branch origin + /auth/confirm as redirectTo. Local development keeps the exact localhost callback configured in supabase/config.toml.

## Production migrations and release

After the one-time activation below, successful main CI delivers repository-controlled forward migrations automatically. These files are the canonical schema history. Do not use Supabase dashboard schema-diff or preview-branch merge output as the production migration path, and do not commit generated branch_merge_* substitutes. Disable Supabase's native production migration integration when this workflow is activated so only one writer applies migrations. PR2 migrations are additive from the existing Foundation schema; do not recreate the private schema or rewrite applied Foundation migrations.

**Any production migration applied before the new application is released must remain backward-compatible with the currently deployed application. Breaking schema changes require an expand/migrate/contract sequence.** Applied migration files are immutable: changing SQL under an already recorded version is outside this gate's detection and requires explicit review.

Before merging dependent application code, review each migration for compatibility with the currently deployed app, destructive changes, and backup/recovery readiness. Destructive or incompatible migrations require separate explicit review and an expand/migrate/contract plan. The workflow links the pinned production project, checks that remote migration versions are a prefix of local migrations, runs a dry run, rechecks history, applies ordinary forward migrations and verifies that all checked-in versions are recorded. Migration-version mismatch, missing credentials, disabled delivery, command failure, or incomplete verification fails the readiness check. This does not inspect schema contents or detect out-of-band dashboard edits. Never reset a hosted database, apply disposable fixtures there, or leave undocumented dashboard schema changes.

Required checks and human merge authorize normal main deployment once the Deployment Check is active. The CI job runs only on an exact main push SHA after the required aggregate succeeds; PR checks remain separate. It uses the pinned Supabase CLI and suppresses credential-bearing CLI output. Main workflow runs do not cancel a running database delivery. GitHub may replace a pending run for an older main SHA when a newer push arrives; only a successful check on the production build's exact SHA can release that build. Verify that SHA, authentication/denial behavior and app health after release. Post-merge CI reports the merge SHA independently from PR-head evidence.

### One-time activation

1. This bootstrap PR changes no application behavior or schema. Its first merge to main may release the unchanged application before Vercel can discover the new GitHub check. Main CI will show `Production database ready` failing while delivery is disabled; PR required checks can remain green. Do not merge schema-dependent application code during this bootstrap window. Repository code alone cannot enforce a Vercel gate before that gate is configured.
2. In GitHub, create environment `production-database` with deployment branches restricted to `main`. Add environment secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`, and environment variable `SUPABASE_PROJECT_REF=dndqydmuqoduwaoujfki`. Keep `ENABLE_PRODUCTION_DB_DELIVERY` unset initially. Do not add manual environment reviewers if release is intended to be automatic.
3. In Vercel's production project, keep GitHub integration and automatic production aliasing enabled. Add a **GitHub Actions Deployment Check** for the unique main job `Production database ready`, required for production. Do not select the PR-only inactive job or the ordinary PR aggregate. Disable the Supabase integration's native production migration application so it cannot race this workflow.
4. Observe a new harmless main production candidate held from its production domain while `Production database ready` is failing because delivery is disabled. Confirm the candidate SHA matches the intended merge, the production project reference and existing migration history are correct, and a usable backup/recovery path exists. Do not force promote the held candidate.
5. Set environment variable `ENABLE_PRODUCTION_DB_DELIVERY=true` (exact lowercase value) and trigger a new normal main push through reviewed code. Confirm the database check passes for that exact SHA and Vercel aliases that candidate only afterward. If activation prerequisites are absent, the readiness check fails; a skipped or green placeholder is never readiness evidence.

`npm run db:deliver:production` is a CI-only command. It requires the trusted GitHub main-push context and environment credentials; local use fails closed. Production passwords and tokens are supplied as environment variables, never command arguments or logs. Keep the deployment check enabled after activation. GitHub branch protection still requires the existing `required` aggregate and normal review, not the production database job on PRs.

Application rollback returns to a compatible previous deployment. Database recovery is deliberate and favors forward fixes; do not automatically reverse migrations destructively.

## External prerequisites

Hosted projects, SMTP, Vercel connection/environment setup, branch protection, initial members, DNS and production authorization require owner setup. This code change does not activate delivery, alter production configuration/data, or run production migrations. An owner-only preview configuration issue must be reported separately after independent local/CI validation.

### Inventory labels and deployment origin

Inventory QR labels contain ordinary application destinations and must be generated for the stable origin of the environment where they will be used. Keep `APP_ORIGIN` unset for Vercel Preview so the existing `VERCEL_BRANCH_URL` resolution selects the branch preview. Set the stable canonical origin explicitly for production. Do not generate production labels with a commit-specific preview URL or copy preview labels into production; a missing canonical origin is an owner configuration prerequisite, not a reason to guess a domain. Without production `APP_ORIGIN`, QR label generation and absolute-URL scan input fail closed with a configuration message; internal relative paths and `LOC:`/`AST:` or bare exact-identifier lookup remain available. QR creation is local. A label does not grant access, and authentication/membership/RLS remain required after a scan. Existing deployment gates and migration delivery behavior are unchanged by this feature.
