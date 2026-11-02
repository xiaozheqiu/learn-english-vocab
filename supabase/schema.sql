-- 背单词 · Oxford 5000 —— 云端同步表（Supabase / Postgres）
--
-- 在 Supabase 控制台 SQL Editor 里整段执行一次即可。可重复执行。
--
-- 设计要点：
--   1. mastery 存「状态 + 时间」，删掉的词落成 mastered=false 的墓碑行 ——
--      否则「取消掌握」这个动作无法同步，另一台设备会把它复活。
--   2. updated_at 一律由触发器写 now()，客户端不传。手机和电脑的时钟差几分钟
--      是常态，用各自的 Date.now() 当裁判会出现「刚标的被旧数据覆盖」。
--   3. RLS 全开：anon key 是公开的（会进前端构建产物），安全性全靠这层策略。

create table if not exists public.mastery (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  word_key   text        not null,           -- 与 Word.key 同规则："A1|abandon|v.|123"
  mastered   boolean     not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, word_key)
);

-- 时间戳由服务端决定
create or replace function public.touch_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mastery_touch on public.mastery;
create trigger mastery_touch
  before insert or update on public.mastery
  for each row execute function public.touch_stamp();

-- 行级安全：每个用户只能碰自己的行
alter table public.mastery enable row level security;

drop policy if exists "own mastery" on public.mastery;
create policy "own mastery" on public.mastery
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 按用户取全量是唯一的热查询，主键已覆盖 (user_id, word_key)，
-- 单独拉 updated_at 的场景不需要额外索引。
