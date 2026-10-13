-- Oxford 5000 进度同步表
-- 在 Supabase 控制台 → SQL Editor 里整段粘贴执行即可。
--
-- 设计：每个「已掌握」的词一行，主键是 (user_id, key)。
-- key 由前端生成，规则与旧版本地存储完全一致：等级|单词|词性[|序号]

create table if not exists public.ox_progress (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- 按用户查全部进度是唯一的热路径
create index if not exists ox_progress_user_idx on public.ox_progress (user_id);

-- 行级安全：任何人只能读写自己的进度
alter table public.ox_progress enable row level security;

drop policy if exists "own rows select" on public.ox_progress;
create policy "own rows select" on public.ox_progress
  for select using (auth.uid() = user_id);

drop policy if exists "own rows insert" on public.ox_progress;
create policy "own rows insert" on public.ox_progress
  for insert with check (auth.uid() = user_id);

drop policy if exists "own rows update" on public.ox_progress;
create policy "own rows update" on public.ox_progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows delete" on public.ox_progress;
create policy "own rows delete" on public.ox_progress
  for delete using (auth.uid() = user_id);
