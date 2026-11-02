-- 把唯一账号的密码设成指定值。
--
-- 跑法：./scripts/db.sh -f supabase/set-password.sql -v pw='新密码'
--       （不传 -v pw 就用下面的默认值；邮箱默认是项目里唯一那个账号）
--
-- 为什么直接改 auth.users 而不是用控制台「重置密码」发邮件：
-- 这个应用只有一个账号、一个用户，找回密码的整条链路（SMTP、确认链接、
-- 落地页）服务的是一个不存在的问题 —— 收不到信、点不动链接，反而把自己
-- 锁在门外。密码是本地事实，直接落库最省事。
--
-- ## 必须用 gen_salt('bf', 10)，不能只写 gen_salt('bf')
--
-- 这条踩过两次，写清楚免得再犯：
--   - `gen_salt('bf')`      → `$2a$06$`，GoTrue 拿去比对会失败，
--                             接口返回 400 invalid_credentials，而库里看
--                             起来「有哈希」，极难从现象反推原因。
--   - `gen_salt('bf', 10)`  → `$2a$10$`，正常。
-- 而且 `crypt(:'pw', gen_salt('bf', 10))` 这条**必须**用 psql 变量传密码：
-- 密码里的 `@` 走 shell/SQL 双层字面量时会被吃掉，同样表现为认证失败。
-- 本脚本末尾会自检一次（crypt(pw, hash) = hash），为 false 就别用这个密码登录。
--
-- 变量必须由 `psql -v` 传入并在 SQL 里以 :'name' 引用；用 heredoc 直接拼
-- 字符串会被转义规则咬到。

\set ON_ERROR_STOP on

-- 没传变量时给默认值
\if :{?email}
\else
  \set email '1533424140@qq.com'
\endif
\if :{?pw}
\else
  \set pw '111111'
\endif

update auth.users
   set encrypted_password = crypt(:'pw', gen_salt('bf', 10)),
       -- 顺手把账号状态收敛成「可登录」：邮箱已确认、没有被封、没有被软删。
       -- 只改这一行，不碰 identity / session。
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       banned_until = null,
       deleted_at = null,
       updated_at = now()
 where email = :'email';

\echo ''
\echo '=== 结果（不打印哈希本体）==='
select email,
       left(encrypted_password, 7) as algo,
       -- 自检：哈希能否验证回输入的密码。f = 这个账号登不进去
       crypt(:'pw', encrypted_password) = encrypted_password as password_ok,
       email_confirmed_at is not null as confirmed,
       banned_until
  from auth.users
 where email = :'email';
