# aime.angkorgate / Malis Internal AI Workspace

This repository is being hardened from an AI marketing tool into an internal company SaaS workspace. The current build is suitable for pilot development only. Do not use it with confidential production data until Supabase RLS, private storage, AI permission filtering, audit logs, backups, and the security test plan are verified.

## Tech Stack

- Vite, React, TypeScript, Tailwind CSS
- Express API server
- Firebase auth currently used by the existing app
- Supabase target for database, auth, storage, RLS, and pgvector
- Gemini/OpenAI-ready AI configuration
- Vercel deployment target

## Local Setup

1. Install dependencies.

```bash
npm install
```

2. Copy environment variables.

```bash
cp .env.example .env
```

3. Fill in the required values.

- `GEMINI_API_KEY` or `OPENAI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- Firebase keys while the current auth layer remains Firebase-backed
- TikTok keys only if TikTok integration is enabled

4. Start the app.

```bash
npm run dev
```

## Supabase Setup

1. Create a Supabase project.
2. Enable email confirmation in Supabase Auth before production.
3. Run `supabase/migrations/001_enterprise_security_baseline.sql`.
4. Run `supabase/seed/001_defaults.sql`.
5. Confirm the `company-files` storage bucket is private.
6. Verify RLS is enabled on all sensitive tables.
7. Run the company isolation and AI permission tests in `TESTING.md`.

## Environment Variables

Required production values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `APP_URL`
- `MAX_FILE_SIZE`
- `DEFAULT_LANGUAGE`
- `AI_MODEL`
- `EMBEDDING_MODEL`
- `SIGNED_URL_EXPIRY_SECONDS`
- `CONFIDENTIAL_SIGNED_URL_EXPIRY_SECONDS`
- `ENABLE_AI_PROCESSING`
- `ENABLE_GUEST_ACCESS`

Security rules:

- Never expose `SUPABASE_SERVICE_ROLE_KEY` on the client.
- Never expose `OPENAI_API_KEY` on the client.
- Use private buckets for confidential company files.
- Rotate keys immediately if any server secret is exposed.

## Database and RLS

The baseline migration creates:

- Company, department, project, profile, and membership tables
- File metadata, permissions, embeddings, tags, versions, and access requests
- AI chat sessions/messages with source references
- Audit logs
- Workflow, task, automation, notification, report, and settings placeholders
- Helper functions including `is_company_member`, `get_user_role`, `can_view_file`, `can_download_file`, `can_edit_file`, `can_delete_file`, `can_use_file_with_ai`
- `match_allowed_file_chunks` for permission-filtered semantic search

RLS must remain enabled in production. Cross-company access prevention must be tested before launch.

## Secure File Storage

All confidential company files must be uploaded to the private `company-files` bucket. Storage paths should be scoped by company ID, for example:

```text
{company_id}/{file_id}/{sanitized_file_name}
```

File access must use signed URLs only. Use shorter expiry for `confidential`, `highly_confidential`, and `executive_only` files. Never return private storage paths or signed URLs in AI answers.

## AI Permission Filtering

AI chat and semantic search must follow this order:

1. Validate authenticated user.
2. Resolve active company membership server-side.
3. Check role and account status.
4. Determine allowed files with RLS/helper functions.
5. Search only permitted embeddings via `match_allowed_file_chunks`.
6. Send only permitted chunks to the model.
7. Cite source file names only.
8. Save chat messages and source references.
9. Write audit logs when sensitive files are used.

If no permitted context exists, return:

```text
I could not find this information in the files you are allowed to access.
```

## Backup and Recovery

Before production:

- Enable daily Supabase database backups.
- Document backup retention in the company security settings.
- Use soft delete for files before permanent deletion.
- Keep `file_versions` records for updated files.
- Back up private storage according to the company retention policy.
- Test restore from database backup in a non-production project.

Recovery procedures:

1. Restore database from the latest known-good Supabase backup.
2. Restore storage objects from backup.
3. Re-run RLS verification tests.
4. Rotate `SUPABASE_SERVICE_ROLE_KEY`, OpenAI/Gemini keys, TikTok secrets, and Firebase keys if compromise is suspected.
5. Disable compromised users in the auth provider and confirm they cannot obtain signed URLs.

## Admin Account Creation

Create the first admin manually after auth is connected:

1. Create the user in the auth provider.
2. Insert a `user_profiles` row.
3. Insert a `company_members` row with role `company_admin` or `super_admin`.
4. Verify the user can view audit logs and settings.
5. Verify staff/viewer users cannot view admin logs.

## Deployment to Vercel

1. Set all server secrets in Vercel project environment variables.
2. Build with `npm run build`.
3. Deploy the Express/Vite app according to `vercel.json`.
4. Confirm production CORS and `APP_URL`.
5. Verify `/api/security/readiness` returns authenticated readiness status.
6. Run the critical test cases from `TESTING.md`.

## Production Gate

Do not call the system production-ready until all are true:

- Authentication and deactivation checks work.
- Company data is isolated by `company_id` and RLS.
- Private storage uses signed URLs only.
- Permission checks pass for preview, download, edit, delete, share, and AI usage.
- AI chat and semantic search use only permitted chunks.
- Confidential file views/downloads/AI queries are audited.
- Recycle bin and version history are tested.
- Backup and restore plan is tested.
- No secret keys are exposed on the client.
