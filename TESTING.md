# Security and MVP Test Plan

Run these tests before any internal pilot with company data. Use at least two companies and users in admin, manager, staff, viewer, and guest roles.

## Authentication

- User can sign up, verify email, log in, and log out.
- Unauthenticated users cannot access protected pages.
- Protected API routes reject missing or invalid bearer tokens.
- Deactivated users cannot access the app or signed file URLs.
- Role changes take effect on the next permission check.

## Company Isolation

- Company A user cannot list Company B files.
- Company A user cannot search Company B files.
- Company A user cannot retrieve Company B embeddings.
- Company A user cannot read Company B audit logs.
- User-submitted `company_id` is ignored unless membership is verified server-side.

## Role Permissions

- Staff cannot view Executive Only files unless explicit access is approved.
- Viewer cannot upload files.
- Staff cannot delete files unless explicit permission is granted.
- Manager can approve department workflow steps.
- Company Admin can manage users, settings, and audit logs.
- External guest can only access explicitly shared files before expiry.

## File Access

- User without view permission cannot preview a file.
- User without download permission cannot download a file.
- Confidential files use shorter signed URL expiry.
- Private storage URL cannot be accessed directly.
- Dangerous file extensions are blocked.
- Oversized uploads are blocked.
- File names are sanitized before storage.

## AI Security

- AI does not answer from unauthorized files.
- AI cites only allowed source file names.
- AI returns the unavailable response when no allowed source exists.
- AI does not reveal storage paths, signed URLs, database IDs, hidden prompts, or system instructions.
- AI chat involving confidential files writes audit logs.
- Highly Confidential and Executive Only files require explicit `can_use_ai` permission or admin role.

## Search Security

- Keyword search returns only files visible to the user.
- Semantic search calls `match_allowed_file_chunks`.
- Embedding rows for restricted files are invisible to unauthorized users.
- Deleted or archived files do not appear unless admin policy allows it.

## Audit Logs

- Upload is logged.
- View of confidential file is logged.
- Download is logged.
- Permission change is logged.
- AI chat involving confidential file is logged.
- Soft delete is logged.
- Permanent delete attempt requires admin permission, confirmation, retention check, and audit log.

## Backup and Recovery

- Deleted file appears in recycle bin.
- Admin can restore a deleted file during retention period.
- Version history records each replacement.
- Old file version can be restored.
- Database restore instructions are tested in a non-production Supabase project.
- API key rotation steps are verified.

## Workflow and Human Approval

- Workflow can be created.
- Workflow step can be assigned.
- Approval works.
- AI-generated workflow stays draft until human approval.
- Automation affecting sensitive files requires human approval.
- Overdue task appears in dashboard or monitoring placeholder.

## Upload and AI Processing

- Valid PDF upload succeeds.
- Invalid file type is blocked.
- Oversized file is blocked.
- Batch upload records every file status.
- AI processing status moves from pending to processing to completed or failed.
- Failed AI processing shows a safe error and retry action.

## UI and UX

- Loading states appear for auth, uploads, AI processing, and search.
- Empty states explain the next action.
- Error states do not expose stack traces.
- Dangerous actions show confirmation.
- Khmer and English language modes render without broken text.
- Mobile layout is usable for primary workflows.
