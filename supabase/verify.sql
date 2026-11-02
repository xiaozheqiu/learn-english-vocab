-- 一次性验收：确认 schema 真的建好、且策略与触发器都在位。
-- 跑法：./scripts/db.sh -f supabase/verify.sql
--
-- 每条查询都设计成「有问题时能看出来」，不靠人眼比对。

\echo '=== 1. 表是否存在 ==='
select tablename,
       case when rowsecurity then 'RLS 已开启' else '!!! RLS 未开启，anon key 谁拿到都能读写 !!!' end as rls
from pg_tables
where schemaname = 'public' and tablename = 'mastery';

\echo ''
\echo '=== 2. 列定义 ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'mastery'
order by ordinal_position;

\echo ''
\echo '=== 3. RLS 策略（应当有 1 条 own mastery，cmd=ALL）==='
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'mastery';

\echo ''
\echo '=== 4. 时间戳触发器（应当有 1 条 mastery_touch）==='
select tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where t.tgrelid = 'public.mastery'::regclass and not t.tgisinternal;

\echo ''
\echo '=== 5. 触发器真的会覆盖 updated_at 吗（实测一次）==='
-- 种一行旧时间戳，触发 UPDATE 后看它是否被抬到 now()
begin;
insert into public.mastery (user_id, word_key, mastered, updated_at)
values ('00000000-0000-0000-0000-000000000000', '__verify__', true, '2000-01-01T00:00:00Z')
on conflict (user_id, word_key) do update set updated_at = '2000-01-01T00:00:00Z';
update public.mastery set mastered = false
where user_id = '00000000-0000-0000-0000-000000000000' and word_key = '__verify__';
select updated_at > '2001-01-01T00:00:00Z' as trigger_works, updated_at
from public.mastery
where user_id = '00000000-0000-0000-0000-000000000000' and word_key = '__verify__';
rollback;

\echo ''
\echo '=== 6. 当前数据量 ==='
select count(*) as rows from public.mastery;
