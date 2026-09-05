# Deployment

## Normal delivery

Feature branch → PR → required checks → preview when configured → human merge to protected main → Vercel production deployment from main.

Do not suppress main deployment or add a custom manual promotion pipeline. Agents do not merge or initiate production actions without explicit authorization. The owner connects GitHub/Vercel and enables main protection with the required aggregate check and review requirements.

Local development and CI pin Node 24.19.0 in .nvmrc. package.json allows Node 24.x because [Vercel manages minor and patch updates](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). The Vercel install command explicitly runs npm 11.11.0 before installing the lockfile; packageManager alone does not select npm without Corepack.

## Environments

Development/CI use disposable local Supabase. Previews use a separate hosted nonproduction project with fictional data. Production uses its own project and real inventory.

One shared preview database is sufficient initially, but incompatible schema-changing previews cannot be certified concurrently. Record the preview schema revision.

| Variable                                                  | Boundary                                 |
| --------------------------------------------------------- | ---------------------------------------- |
| NEXT_PUBLIC_SUPABASE_URL                                  | Environment-specific public backend URL  |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY                      | Public key; RLS remains mandatory        |
| APP_ORIGIN                                                | Optional server-only origin override     |
| APP_ENV                                                   | Server-only environment label            |
| Supabase access token/project reference/database password | Owner migration tooling only             |
| Service-role credential                                   | Owner administration/local fixtures only |

Commit placeholders only. Public values are build inputs; do not reuse an artifact built for another backend. Never run migrations inside Next build.

## Auth provisioning

Keep the email/password provider enabled while disabling new-user signup and anonymous sign-in. Set custom SMTP before real invitations and apply the checked-in invite/recovery templates. Invitations do not grant data access until the owner creates an active viewer/staff membership.

Origin precedence is explicit APP_ORIGIN → VERCEL_BRANCH_URL → http://localhost:3000. The branch hostname is normalized to HTTPS with no trailing slash; commit-specific VERCEL_URL is not used. Enable access to [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables). Leave APP_ORIGIN unset in the Preview environment so every Git branch resolves automatically; remove any inherited localhost or production override there. Set APP_ORIGIN explicitly for the production custom domain and non-Vercel hosted deployments.

In the separate nonproduction Supabase project's Auth redirect allowlist, configure a Vercel preview wildcard once: `https://<project-slug>-git-*-<team-or-account-slug>.vercel.app/auth/confirm`. Replace the placeholders using the actual stable branch hostname and verify that it matches; do not include literal angle brackets. This scopes the wildcard to this project's branch previews and the exact callback path. Supabase supports [preview redirect wildcards](https://supabase.com/docs/guides/auth/redirect-urls). Keep production's Site URL and redirect allowlist exact (for example, `https://inventory.example.com` and `https://inventory.example.com/auth/confirm`); do not add preview wildcards to the production project.

Templates honor the requested full /auth/confirm callback and fall back to Site URL + /auth/confirm when no override is supplied. Use an origin without a trailing slash for Site URL. When inviting into a preview explicitly, supply its stable branch origin + /auth/confirm as redirectTo. Local development keeps the exact localhost callback configured in supabase/config.toml.

## Production migrations and release

Production migrations remain explicit and owner-controlled.

**Any production migration applied before an application merge must remain backward-compatible with the currently deployed application. Breaking schema changes require an expand/migrate/contract sequence.**

Before merging dependent application code, verify target, migration list and backup/recovery readiness; apply required forward migrations and check migration status. Never reset a hosted database, apply disposable fixtures there, or leave undocumented dashboard schema changes.

Required checks and human merge authorize normal main deployment. Verify its exact SHA, authentication/denial behavior and app health. Post-merge CI reports the merge SHA independently from PR-head evidence.

Application rollback returns to a compatible previous deployment. Database recovery is deliberate and favors forward fixes; do not automatically reverse migrations destructively.

## External prerequisites

Hosted projects, SMTP, Vercel connection/environment setup, branch protection, initial members, DNS and production authorization require owner setup. They are separate from repository/local code work. This foundation task does not modify billing, hosted configuration or production.
