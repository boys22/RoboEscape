-- =====================================================================
-- RoboEscape 순위표 (Supabase · SQL Editor에 통째로 붙여 넣고 Run)
--  - 브라우저는 표에 직접 쓸 수 없고, 아래 두 함수를 거쳐서만 기록돼요.
--  - 여러 번 실행해도 안전해요 (있으면 건너뛰거나 덮어써요).
-- =====================================================================

-- 1) 판 토큰: 게임을 시작할 때 서버가 발급하고 시작 시각을 기록
create table if not exists public.re_runs (
  token      uuid primary key default gen_random_uuid(),
  device     text not null,
  version    text not null,
  started_at timestamptz not null default now(),
  used       boolean not null default false
);
create index if not exists re_runs_device_idx on public.re_runs (device, started_at desc);

-- 2) 순위표: 닉네임마다 최고 기록 1개
create table if not exists public.re_scores (
  name       text primary key,
  score      integer not null,
  time_sec   integer not null,
  room       integer not null,
  cleared    boolean not null default false,
  kills      integer not null default 0,
  robot      text,
  weapon     text,
  version    text,
  updated_at timestamptz not null default now()
);
create index if not exists re_scores_rank_idx on public.re_scores (score desc, time_sec asc);

-- 3) 행 수준 보안: 순위표는 누구나 읽기만, 토큰 표는 아무도 직접 접근 못 함
alter table public.re_runs   enable row level security;
alter table public.re_scores enable row level security;
drop policy if exists "re_scores 읽기" on public.re_scores;
create policy "re_scores 읽기" on public.re_scores for select using (true);
revoke all on public.re_runs from anon, authenticated;
revoke insert, update, delete on public.re_scores from anon, authenticated;
grant select on public.re_scores to anon, authenticated;

-- 4) 게임 시작: 판 토큰 발급 (같은 기기에서 10초 안에 다시 시작하면 거절)
create or replace function public.re_start_run(p_device text, p_version text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
begin
  if p_device is null or length(p_device) < 8 or length(p_device) > 64 then
    raise exception 'bad_device';
  end if;
  if p_version is null or p_version !~ '^b[0-9]+\.[0-9]+\.[0-9]+$' then
    raise exception 'bad_version';
  end if;
  if exists (select 1 from re_runs where device = p_device and started_at > now() - interval '10 seconds') then
    raise exception 'too_fast';
  end if;
  delete from re_runs where started_at < now() - interval '1 day';   -- 오래된 토큰 정리
  insert into re_runs (device, version) values (p_device, p_version) returning token into t;
  return t;
end;
$$;

-- 5) 기록 제출: 검사 후 통과하면 닉네임의 최고 기록을 갱신
--    점수 규칙(게임 기준): 처치 최대 50점(정예 2배) · 방 클리어 최대 150 · 긴급 생산 라인 300
--                         보스 3마리 1000씩 · 멀티암 팔 150×3 · 구역 돌파/탈출 500×3
create or replace function public.re_submit_run(
  p_token uuid, p_device text, p_name text,
  p_score integer, p_time integer, p_room integer, p_cleared boolean,
  p_kills integer, p_robot text, p_weapon text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  r        re_runs%rowtype;
  elapsed  numeric;
  nm       text;
  max_sc   integer;
  improved boolean := false;
  best     re_scores%rowtype;
  rk       integer;
begin
  select * into r from re_runs where token = p_token for update;
  if not found or r.used or r.device <> p_device then
    return json_build_object('ok', false, 'error', 'token');
  end if;
  update re_runs set used = true where token = p_token;   -- 한 토큰은 한 번만
  elapsed := extract(epoch from (now() - r.started_at));

  -- 닉네임: 앞뒤 공백 제거, 제어 문자 제거, 1~12자
  nm := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
  if length(nm) < 1 or length(nm) > 12 then
    return json_build_object('ok', false, 'error', 'name');
  end if;

  -- 값 범위
  if p_room is null or p_room < 1 or p_room > 21
     or p_score is null or p_score < 0
     or p_time is null or p_time < 0
     or p_kills is null or p_kills < 0 or p_kills > p_room * 45
     or (p_cleared and p_room <> 21) then
    return json_build_object('ok', false, 'error', 'range');
  end if;

  -- 시간: 방 하나에 최소 8초, 게임이 보낸 시간이 서버가 잰 시간보다 길 수 없음
  if p_time < p_room * 8 or p_time > elapsed + 15 then
    return json_build_object('ok', false, 'error', 'time');
  end if;

  -- 점수 상한
  max_sc := p_kills * 50 + p_room * 450 + 6000;
  if p_score > max_sc then
    return json_build_object('ok', false, 'error', 'score');
  end if;

  -- 최고 기록만 남김 (점수가 높거나, 같으면 시간이 짧을 때만 갱신)
  insert into re_scores as s (name, score, time_sec, room, cleared, kills, robot, weapon, version, updated_at)
  values (nm, p_score, p_time, p_room, coalesce(p_cleared, false), p_kills, left(p_robot, 16), left(p_weapon, 16), r.version, now())
  on conflict (name) do update
    set score = excluded.score, time_sec = excluded.time_sec, room = excluded.room, cleared = excluded.cleared,
        kills = excluded.kills, robot = excluded.robot, weapon = excluded.weapon, version = excluded.version, updated_at = now()
    where excluded.score > s.score or (excluded.score = s.score and excluded.time_sec < s.time_sec)
  returning true into improved;
  improved := coalesce(improved, false);

  select * into best from re_scores where name = nm;
  select count(*) + 1 into rk from re_scores
   where score > best.score or (score = best.score and time_sec < best.time_sec);

  return json_build_object('ok', true, 'improved', improved, 'rank', rk, 'best', best.score);
end;
$$;

-- 6) 실행 권한: 함수만 공개
revoke all on function public.re_start_run(text, text) from public;
revoke all on function public.re_submit_run(uuid, text, text, integer, integer, integer, boolean, integer, text, text) from public;
grant execute on function public.re_start_run(text, text) to anon, authenticated;
grant execute on function public.re_submit_run(uuid, text, text, integer, integer, integer, boolean, integer, text, text) to anon, authenticated;

-- 끝. 수상한 기록은 Table Editor → re_scores 에서 그 줄을 지우면 돼요.
