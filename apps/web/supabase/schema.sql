-- CodeLapse: everything the hosted site stores, in one Supabase project.
-- Run once in the Supabase SQL editor (safe to run again).
--
-- Only the site's server reads and writes, using the secret (service role) key.
-- Row-level security is on with no policies, and the views run with the
-- caller's rights, so the public (anon) key can read nothing.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.submissions (
  id            text primary key check (id ~ '^[a-z0-9-]+$'),
  assignment_id text not null,
  student_id    text not null,
  student_name  text,
  submitted_at  timestamptz not null,
  -- The whole SubmissionRecord the site works with (recording summary, replay check, moments).
  record        jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists submissions_assignment_idx on public.submissions (assignment_id, submitted_at desc);

-- One row per submission and kind of record: questions, answers, evaluation,
-- code_check, hint_progress, feedback (the instructor's ratings), ai_detection
-- (the optional external AI-code detector).
create table if not exists public.submission_docs (
  submission_id text not null references public.submissions (id) on delete cascade,
  kind          text not null check (kind in ('questions', 'answers', 'evaluation', 'code_check', 'hint_progress', 'feedback', 'ai_detection', 'voice')),
  data          jsonb not null,
  -- Bumped on every update, so the site can update hint progress without overwriting a parallel change.
  version       integer not null default 1,
  updated_at    timestamptz not null default now(),
  primary key (submission_id, kind)
);

-- Databases made before ai_detection and voice existed: widen the allowed kinds.
alter table public.submission_docs drop constraint if exists submission_docs_kind_check;
alter table public.submission_docs add constraint submission_docs_kind_check
  check (kind in ('questions', 'answers', 'evaluation', 'code_check', 'hint_progress', 'feedback', 'ai_detection', 'voice'));

create table if not exists public.settings (
  key   text primary key,
  value text not null
);

create or replace function public.codelapse_bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists submission_docs_bump_version on public.submission_docs;
create trigger submission_docs_bump_version before update on public.submission_docs
  for each row execute function public.codelapse_bump_version();

alter table public.submissions enable row level security;
alter table public.submission_docs enable row level security;
alter table public.settings enable row level security;

-- ---------------------------------------------------------------------------
-- Files: a private bucket for recordings and code (30 MB per file)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('codelapse', 'codelapse', false, 31457280)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- Research views: the same tables the SQLite research database has, live.
-- Participants appear as codes (P + 8 hex digits of sha256(salt + student id)),
-- using the salt in settings ('research-salt'), so they match the CSV exports.
-- ---------------------------------------------------------------------------

create or replace view public.v_submissions with (security_invoker = true) as
select
  s.id                                                        as submission_id,
  'P' || left(encode(sha256(convert_to(coalesce(salt.value, '') || s.student_id, 'UTF8')), 'hex'), 8) as participant_id,
  s.assignment_id,
  s.submitted_at,
  (s.record -> 'recording' ->> 'sessionCount')::int           as sessions,
  round((s.record -> 'recording' ->> 'recordedMs')::numeric / 60000, 1) as recorded_minutes,
  (s.record -> 'recording' ->> 'typedChars')::int             as typed_chars,
  (s.record -> 'recording' ->> 'bulkInsertedChars')::int      as bulk_inserted_chars,
  (s.record -> 'recording' ->> 'preExistingChars')::int       as pre_existing_chars,
  (s.record -> 'recording' -> 'runs' ->> 'passed')::int       as runs_passed,
  (s.record -> 'recording' -> 'runs' ->> 'failed')::int       as runs_failed,
  s.record -> 'replay' ->> 'verdict'                          as replay_verdict,
  jsonb_array_length(coalesce(s.record -> 'moments', '[]'))   as moments
from public.submissions s
left join public.settings salt on salt.key = 'research-salt';

create or replace view public.v_questions with (security_invoker = true) as
select
  d.submission_id,
  q.position::int                          as position,
  q.value ->> 'id'                         as question_id,
  q.value ->> 'type'                       as type,
  q.value ->> 'concept'                    as concept,
  q.value ->> 'text'                       as text,
  q.value ->> 'momentId'                   as moment_id,
  q.value -> 'codeRef' ->> 'file'          as code_file,
  (q.value -> 'codeRef' ->> 'startLine')::int as code_start,
  (q.value -> 'codeRef' ->> 'endLine')::int   as code_end,
  q.value ->> 'rationale'                  as rationale,
  q.value -> 'strongAnswerPoints'          as strong_answer_points,
  d.data ->> 'model'                       as generator_model,
  d.data ->> 'promptVersion'               as prompt_version
from public.submission_docs d
cross join lateral jsonb_array_elements(coalesce(d.data -> 'questions', '[]')) with ordinality as q(value, position)
where d.kind = 'questions';

create or replace view public.v_answers with (security_invoker = true) as
select
  d.submission_id,
  a.value ->> 'questionId'                                     as question_id,
  a.value ->> 'text'                                           as text,
  length(a.value ->> 'text')                                   as chars,
  coalesce(array_length(regexp_split_to_array(btrim(a.value ->> 'text'), '\s+'), 1), 0) as words,
  to_timestamp((d.data ->> 'submittedAt')::double precision / 1000) as submitted_at
from public.submission_docs d
cross join lateral jsonb_array_elements(coalesce(d.data -> 'answers', '[]')) as a(value)
where d.kind = 'answers';

create or replace view public.v_reviews with (security_invoker = true) as
select
  d.submission_id,
  e.value ->> 'questionId'                          as question_id,
  (e.value ->> 'addressesQuestion')::boolean        as addresses_question,
  (e.value -> 'scores' ->> 'specificity')::int      as specificity,
  (e.value -> 'scores' ->> 'consistency')::int      as consistency,
  (e.value -> 'scores' ->> 'reasoning')::int        as reasoning,
  (e.value -> 'scores' ->> 'specificity')::int + (e.value -> 'scores' ->> 'consistency')::int
    + (e.value -> 'scores' ->> 'reasoning')::int    as total,
  e.value ->> 'level'                               as level,
  e.value -> 'evidenceQuotes'                       as evidence_quotes,
  e.value ->> 'explanation'                         as explanation,
  e.value -> 'concerns'                             as concerns,
  d.data ->> 'model'                                as reviewer_model,
  d.data ->> 'promptVersion'                        as prompt_version
from public.submission_docs d
cross join lateral jsonb_array_elements(coalesce(d.data -> 'evaluations', '[]')) as e(value)
where d.kind = 'evaluation' and d.data ->> 'status' = 'ready';

create or replace view public.v_review_summaries with (security_invoker = true) as
select
  d.submission_id,
  d.data ->> 'status'                      as status,
  d.data ->> 'summary'                     as summary,
  d.data ->> 'notesForInstructor'          as notes,
  d.data ->> 'error'                       as error,
  (d.data -> 'counts' ->> 'strong')::int   as strong,
  (d.data -> 'counts' ->> 'partial')::int  as partial,
  (d.data -> 'counts' ->> 'limited')::int  as limited
from public.submission_docs d
where d.kind = 'evaluation';

create or replace view public.v_code_checks with (security_invoker = true) as
select
  d.submission_id,
  d.data ->> 'status'                                  as status,
  (d.data ->> 'works')::boolean                        as works,
  jsonb_array_length(coalesce(d.data -> 'issues', '[]')) as issue_count,
  d.data ->> 'summaryForInstructor'                    as summary,
  d.data ->> 'error'                                   as error,
  d.data -> 'traces'                                   as traces,
  d.data ->> 'model'                                   as model,
  d.data ->> 'promptVersion'                           as prompt_version
from public.submission_docs d
where d.kind = 'code_check';

create or replace view public.v_code_issues with (security_invoker = true) as
select
  d.submission_id,
  i.position::int                                       as position,
  i.value ->> 'id'                                      as issue_id,
  i.value ->> 'severity'                                as severity,
  i.value ->> 'concept'                                 as concept,
  i.value ->> 'title'                                   as title,
  i.value -> 'codeRef' ->> 'file'                       as code_file,
  (i.value -> 'codeRef' ->> 'startLine')::int           as code_start,
  (i.value -> 'codeRef' ->> 'endLine')::int             as code_end,
  i.value ->> 'whatHappens'                             as what_happens,
  i.value -> 'hints'                                    as hints,
  i.value ->> 'explanationForInstructor'                as explanation,
  jsonb_array_length(coalesce(i.value -> 'hints', '[]')) as hint_count,
  coalesce((p.data -> 'issues' -> (i.value ->> 'id') ->> 'hintsShown')::int, 1) as hints_opened,
  p.data -> 'issues' -> (i.value ->> 'id') ->> 'reflection' as reflection
from public.submission_docs d
cross join lateral jsonb_array_elements(coalesce(d.data -> 'issues', '[]')) with ordinality as i(value, position)
left join public.submission_docs p on p.submission_id = d.submission_id and p.kind = 'hint_progress'
where d.kind = 'code_check' and d.data ->> 'status' = 'ready';

create or replace view public.v_instructor_ratings with (security_invoker = true) as
select
  d.submission_id,
  r.key                                    as question_id,
  r.value ->> 'agreement'                  as agreement,
  r.value ->> 'ownLevel'                   as own_level,
  nullif(r.value ->> 'note', '')           as answer_note,
  (d.data -> 'questions' -> r.key ->> 'useful')::boolean as question_useful,
  nullif(d.data -> 'questions' -> r.key ->> 'note', '')  as question_note
from public.submission_docs d
cross join lateral jsonb_each(coalesce(d.data -> 'answers', '{}')) as r(key, value)
where d.kind = 'feedback';

-- Questions, answers, AI reviews and instructor ratings side by side.
create or replace view public.v_answer_reviews with (security_invoker = true) as
select
  s.participant_id, s.assignment_id, q.submission_id, q.question_id, q.position, q.type as question_type, q.concept,
  q.text as question, a.text as answer, a.words as answer_words,
  r.specificity, r.consistency, r.reasoning, r.total, r.level as review_level, r.explanation as review_explanation,
  ir.agreement as instructor_agreement, ir.own_level as instructor_level, ir.question_useful
from public.v_questions q
join public.v_submissions s on s.submission_id = q.submission_id
left join public.v_answers a on a.submission_id = q.submission_id and a.question_id = q.question_id
left join public.v_reviews r on r.submission_id = q.submission_id and r.question_id = q.question_id
left join public.v_instructor_ratings ir on ir.submission_id = q.submission_id and ir.question_id = q.question_id;

-- Nothing here is for the public API keys.
revoke all on public.submissions, public.submission_docs, public.settings from anon, authenticated;
revoke all on public.v_submissions, public.v_questions, public.v_answers, public.v_reviews, public.v_review_summaries,
  public.v_code_checks, public.v_code_issues, public.v_instructor_ratings, public.v_answer_reviews from anon, authenticated;
