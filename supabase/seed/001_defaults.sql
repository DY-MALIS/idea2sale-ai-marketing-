insert into public.companies (id, name, default_language)
values ('00000000-0000-0000-0000-000000000001', 'Pilot Company', 'en')
on conflict (id) do nothing;

insert into public.settings (company_id, key, value)
values
  ('00000000-0000-0000-0000-000000000001', 'roles', '{"roles":["super_admin","company_admin","manager","staff","viewer","guest"]}'),
  ('00000000-0000-0000-0000-000000000001', 'categories', '{"categories":["policy","contract","finance","hr","marketing","operations","general"]}'),
  ('00000000-0000-0000-0000-000000000001', 'confidentiality_levels', '{"levels":["public","internal","confidential","highly_confidential","executive_only"]}'),
  ('00000000-0000-0000-0000-000000000001', 'workflow_templates', '{"templates":[{"name":"Confidential access approval","requires_human_approval":true},{"name":"Document review","requires_human_approval":true}]}'),
  ('00000000-0000-0000-0000-000000000001', 'security', '{"require_email_verification":true,"two_factor_placeholder":true,"disable_confidential_downloads":true,"ai_usage_reminder":true}')
on conflict (company_id, key) do update set value = excluded.value;
