-- Malis/aime enterprise security baseline for Supabase.
-- Run in Supabase SQL editor or with `supabase db push`.

create extension if not exists vector;
create extension if not exists pgcrypto;

create type public.company_role as enum ('super_admin', 'company_admin', 'manager', 'staff', 'viewer', 'guest');
create type public.member_status as enum ('active', 'invited', 'deactivated');
create type public.confidentiality_level as enum ('public', 'internal', 'confidential', 'highly_confidential', 'executive_only');
create type public.file_lifecycle_status as enum ('draft', 'active', 'under_review', 'approved', 'archived', 'deleted', 'expired');
create type public.review_status as enum ('current', 'needs_review', 'outdated', 'archived');
create type public.access_request_status as enum ('pending', 'approved', 'rejected', 'expired', 'revoked');
create type public.processing_status as enum ('pending', 'processing', 'completed', 'failed');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_language text not null default 'en' check (default_language in ('en', 'km')),
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text not null,
  is_deactivated boolean not null default false,
  email_verified_at timestamptz,
  two_factor_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role public.company_role not null default 'staff',
  status public.member_status not null default 'active',
  department_id uuid references public.departments(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id, user_id)
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  owner_id uuid references public.user_profiles(id) on delete set null,
  uploaded_by uuid not null references public.user_profiles(id),
  responsible_manager uuid references public.user_profiles(id) on delete set null,
  title text not null,
  description text,
  category text not null default 'general',
  confidentiality_level public.confidentiality_level not null default 'internal',
  file_type text not null,
  business_purpose text,
  retention_policy text not null default 'review_12_months',
  storage_bucket text not null default 'company-files',
  storage_path text not null,
  file_hash text,
  size_bytes bigint not null default 0,
  lifecycle_status public.file_lifecycle_status not null default 'active',
  ai_processing_status public.processing_status not null default 'pending',
  ai_summary text,
  ai_suggested_tags text[] not null default '{}',
  ai_suggested_confidentiality public.confidentiality_level,
  last_reviewed_at timestamptz,
  next_review_date timestamptz,
  reviewed_by uuid references public.user_profiles(id) on delete set null,
  review_status public.review_status not null default 'current',
  deleted_at timestamptz,
  deleted_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.file_metadata (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.file_permissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  user_id uuid references public.user_profiles(id) on delete cascade,
  role public.company_role,
  can_view boolean not null default false,
  can_download boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_use_ai boolean not null default false,
  expires_at timestamptz,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (user_id is not null or role is not null)
);

create table public.file_embeddings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  chunk_index integer not null,
  chunk_text text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  unique(company_id, name)
);

create table public.file_tags (
  company_id uuid not null references public.companies(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key(file_id, tag_id)
);

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  requested_by uuid not null references public.user_profiles(id),
  reason text not null,
  status public.access_request_status not null default 'pending',
  approved_by uuid references public.user_profiles(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.file_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  version_number integer not null,
  storage_path text not null,
  uploaded_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  unique(file_id, version_number)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid references public.user_profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  sensitivity public.confidentiality_level,
  metadata jsonb not null default '{}',
  ip_address inet,
  created_at timestamptz not null default now()
);

create table public.ai_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id),
  title text,
  created_at timestamptz not null default now()
);

create table public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null references public.ai_chat_sessions(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  source_file_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  status text not null default 'draft',
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  title text not null,
  assigned_to uuid references public.user_profiles(id) on delete set null,
  requires_human_approval boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  assigned_to uuid references public.user_profiles(id) on delete set null,
  status text not null default 'open',
  due_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  enabled boolean not null default false,
  conditions jsonb not null default '{}',
  requires_human_approval boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id),
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  report_type text not null,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}',
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(company_id, key)
);

create index files_company_idx on public.files(company_id);
create index files_confidentiality_idx on public.files(confidentiality_level);
create index files_status_idx on public.files(lifecycle_status);
create index files_created_idx on public.files(created_at desc);
create index file_permissions_file_user_idx on public.file_permissions(file_id, user_id);
create index file_embeddings_company_file_idx on public.file_embeddings(company_id, file_id);
create index file_embeddings_vector_idx on public.file_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index audit_logs_company_created_idx on public.audit_logs(company_id, created_at desc);

create or replace function public.is_company_member(target_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members cm
    join public.user_profiles up on up.id = cm.user_id
    where cm.company_id = target_company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and up.is_deactivated = false
  );
$$;

create or replace function public.get_user_role(target_company_id uuid)
returns public.company_role language sql stable security definer set search_path = public as $$
  select cm.role from public.company_members cm
  join public.user_profiles up on up.id = cm.user_id
  where cm.company_id = target_company_id
    and cm.user_id = auth.uid()
    and cm.status = 'active'
    and up.is_deactivated = false
  limit 1;
$$;

create or replace function public.is_company_admin(target_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.get_user_role(target_company_id) in ('super_admin', 'company_admin');
$$;

create or replace function public.can_view_file(target_file_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.files f
    left join public.file_permissions fp on fp.file_id = f.id
      and (fp.user_id = auth.uid() or fp.role = public.get_user_role(f.company_id))
      and (fp.expires_at is null or fp.expires_at > now())
    where f.id = target_file_id
      and f.lifecycle_status <> 'deleted'
      and public.is_company_member(f.company_id)
      and (
        f.uploaded_by = auth.uid()
        or public.is_company_admin(f.company_id)
        or coalesce(fp.can_view, false)
        or f.confidentiality_level in ('public', 'internal')
      )
  );
$$;

create or replace function public.can_download_file(target_file_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.files f
    left join public.file_permissions fp on fp.file_id = f.id
      and (fp.user_id = auth.uid() or fp.role = public.get_user_role(f.company_id))
      and (fp.expires_at is null or fp.expires_at > now())
    where f.id = target_file_id
      and public.can_view_file(f.id)
      and f.confidentiality_level not in ('highly_confidential', 'executive_only')
      and (public.is_company_admin(f.company_id) or coalesce(fp.can_download, false))
  );
$$;

create or replace function public.can_edit_file(target_file_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.files f
    left join public.file_permissions fp on fp.file_id = f.id
      and (fp.user_id = auth.uid() or fp.role = public.get_user_role(f.company_id))
    where f.id = target_file_id
      and public.can_view_file(f.id)
      and (f.uploaded_by = auth.uid() or public.is_company_admin(f.company_id) or coalesce(fp.can_edit, false))
  );
$$;

create or replace function public.can_delete_file(target_file_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.files f
    left join public.file_permissions fp on fp.file_id = f.id
      and (fp.user_id = auth.uid() or fp.role = public.get_user_role(f.company_id))
    where f.id = target_file_id
      and public.can_view_file(f.id)
      and (public.is_company_admin(f.company_id) or coalesce(fp.can_delete, false))
  );
$$;

create or replace function public.can_use_file_with_ai(target_file_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.files f
    left join public.file_permissions fp on fp.file_id = f.id
      and (fp.user_id = auth.uid() or fp.role = public.get_user_role(f.company_id))
      and (fp.expires_at is null or fp.expires_at > now())
    where f.id = target_file_id
      and public.can_view_file(f.id)
      and (public.is_company_admin(f.company_id) or coalesce(fp.can_use_ai, false) or f.confidentiality_level in ('public', 'internal'))
  );
$$;

create or replace function public.match_allowed_file_chunks(
  query_embedding vector(1536),
  match_count int,
  target_company_id uuid
)
returns table (
  file_id uuid,
  source_title text,
  chunk_text text,
  similarity float
) language sql stable security definer set search_path = public as $$
  select e.file_id, f.title, e.chunk_text, 1 - (e.embedding <=> query_embedding) as similarity
  from public.file_embeddings e
  join public.files f on f.id = e.file_id
  where e.company_id = target_company_id
    and public.is_company_member(target_company_id)
    and public.can_use_file_with_ai(e.file_id)
  order by e.embedding <=> query_embedding
  limit least(match_count, 12);
$$;

alter table public.companies enable row level security;
alter table public.departments enable row level security;
alter table public.projects enable row level security;
alter table public.user_profiles enable row level security;
alter table public.company_members enable row level security;
alter table public.files enable row level security;
alter table public.file_metadata enable row level security;
alter table public.file_embeddings enable row level security;
alter table public.file_permissions enable row level security;
alter table public.tags enable row level security;
alter table public.file_tags enable row level security;
alter table public.access_requests enable row level security;
alter table public.file_versions enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.tasks enable row level security;
alter table public.automations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.ai_chat_sessions enable row level security;
alter table public.ai_chat_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.settings enable row level security;

create policy "members can view their companies" on public.companies for select using (public.is_company_member(id));
create policy "members can view company departments" on public.departments for select using (public.is_company_member(company_id));
create policy "members can view company projects" on public.projects for select using (public.is_company_member(company_id));
create policy "users can view own profile" on public.user_profiles for select using (id = auth.uid());
create policy "admins can view company members" on public.company_members for select using (public.is_company_member(company_id));
create policy "admins manage company members" on public.company_members for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

create policy "users view permitted files" on public.files for select using (public.can_view_file(id));
create policy "members upload files" on public.files for insert with check (public.is_company_member(company_id) and uploaded_by = auth.uid());
create policy "users edit permitted files" on public.files for update using (public.can_edit_file(id)) with check (public.can_edit_file(id));
create policy "admins soft delete files only" on public.files for delete using (false);

create policy "metadata follows file visibility" on public.file_metadata for select using (public.can_view_file(file_id));
create policy "embeddings follow ai permission" on public.file_embeddings for select using (public.can_use_file_with_ai(file_id));
create policy "permissions visible to admins" on public.file_permissions for select using (public.is_company_admin(company_id) or user_id = auth.uid());
create policy "admins manage permissions" on public.file_permissions for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy "tags visible to members" on public.tags for select using (public.is_company_member(company_id));
create policy "file tags follow file visibility" on public.file_tags for select using (public.can_view_file(file_id));

create policy "users can request access" on public.access_requests for insert with check (requested_by = auth.uid() and public.is_company_member(company_id));
create policy "users see own access requests" on public.access_requests for select using (requested_by = auth.uid() or public.is_company_admin(company_id));
create policy "admins update access requests" on public.access_requests for update using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

create policy "versions follow file visibility" on public.file_versions for select using (public.can_view_file(file_id));
create policy "company records visible to members" on public.workflows for select using (public.is_company_member(company_id));
create policy "company workflow steps visible to members" on public.workflow_steps for select using (public.is_company_member(company_id));
create policy "company tasks visible to members" on public.tasks for select using (public.is_company_member(company_id));
create policy "automations visible to admins" on public.automations for select using (public.is_company_admin(company_id));
create policy "notifications visible to owner" on public.notifications for select using (user_id = auth.uid());
create policy "reports visible to admins" on public.reports for select using (public.is_company_admin(company_id));
create policy "settings visible to admins" on public.settings for select using (public.is_company_admin(company_id));
create policy "admins manage settings" on public.settings for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

create policy "audit logs visible to admins only" on public.audit_logs for select using (public.is_company_admin(company_id));
create policy "system can insert audit logs" on public.audit_logs for insert with check (public.is_company_member(company_id));
create policy "chat sessions visible to owner" on public.ai_chat_sessions for select using (user_id = auth.uid() and public.is_company_member(company_id));
create policy "chat messages visible to owner" on public.ai_chat_messages for select using (user_id = auth.uid() and public.is_company_member(company_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-files',
  'company-files',
  false,
  52428800,
  array['application/pdf','text/plain','text/csv','image/png','image/jpeg','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation']
)
on conflict (id) do update set public = false;

create policy "no direct storage reads" on storage.objects for select using (false);
create policy "members upload to company prefix" on storage.objects for insert with check (
  bucket_id = 'company-files'
  and public.is_company_member((storage.foldername(name))[1]::uuid)
);
