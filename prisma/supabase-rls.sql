grant usage on schema public to authenticated;

grant select, insert, update, delete on table
  public."User",
  public."UserPreferences",
  public."Script",
  public."Character",
  public."ClueCard",
  public."GameSession",
  public."SessionCharacter",
  public."Message",
  public."Vote",
  public."ClueRelease"
to authenticated;

alter table public."User" enable row level security;
alter table public."UserPreferences" enable row level security;
alter table public."Script" enable row level security;
alter table public."Character" enable row level security;
alter table public."ClueCard" enable row level security;
alter table public."GameSession" enable row level security;
alter table public."SessionCharacter" enable row level security;
alter table public."Message" enable row level security;
alter table public."Vote" enable row level security;
alter table public."ClueRelease" enable row level security;

drop policy if exists "own user select" on public."User";
drop policy if exists "own user insert" on public."User";
drop policy if exists "own user update" on public."User";
create policy "own user select" on public."User"
  for select to authenticated
  using ((select auth.uid())::text = id);
create policy "own user insert" on public."User"
  for insert to authenticated
  with check ((select auth.uid())::text = id);
create policy "own user update" on public."User"
  for update to authenticated
  using ((select auth.uid())::text = id)
  with check ((select auth.uid())::text = id);

drop policy if exists "own preferences select" on public."UserPreferences";
drop policy if exists "own preferences insert" on public."UserPreferences";
drop policy if exists "own preferences update" on public."UserPreferences";
drop policy if exists "own preferences delete" on public."UserPreferences";
create policy "own preferences select" on public."UserPreferences"
  for select to authenticated
  using ((select auth.uid())::text = "userId");
create policy "own preferences insert" on public."UserPreferences"
  for insert to authenticated
  with check ((select auth.uid())::text = "userId");
create policy "own preferences update" on public."UserPreferences"
  for update to authenticated
  using ((select auth.uid())::text = "userId")
  with check ((select auth.uid())::text = "userId");
create policy "own preferences delete" on public."UserPreferences"
  for delete to authenticated
  using ((select auth.uid())::text = "userId");

drop policy if exists "script select owned or builtin" on public."Script";
drop policy if exists "own script insert" on public."Script";
drop policy if exists "own script update" on public."Script";
drop policy if exists "own script delete" on public."Script";
create policy "script select owned or builtin" on public."Script"
  for select to authenticated
  using ((select auth.uid())::text = "userId" or source = 'BUILTIN');
create policy "own script insert" on public."Script"
  for insert to authenticated
  with check ((select auth.uid())::text = "userId");
create policy "own script update" on public."Script"
  for update to authenticated
  using ((select auth.uid())::text = "userId")
  with check ((select auth.uid())::text = "userId");
create policy "own script delete" on public."Script"
  for delete to authenticated
  using ((select auth.uid())::text = "userId");

drop policy if exists "character select via script" on public."Character";
drop policy if exists "character insert via script" on public."Character";
drop policy if exists "character update via script" on public."Character";
drop policy if exists "character delete via script" on public."Character";
create policy "character select via script" on public."Character"
  for select to authenticated
  using (exists (
    select 1 from public."Script" s
    where s.id = "Character"."scriptId"
      and (s."userId" = (select auth.uid())::text or s.source = 'BUILTIN')
  ));
create policy "character insert via script" on public."Character"
  for insert to authenticated
  with check (exists (
    select 1 from public."Script" s
    where s.id = "Character"."scriptId"
      and s."userId" = (select auth.uid())::text
  ));
create policy "character update via script" on public."Character"
  for update to authenticated
  using (exists (
    select 1 from public."Script" s
    where s.id = "Character"."scriptId"
      and s."userId" = (select auth.uid())::text
  ))
  with check (exists (
    select 1 from public."Script" s
    where s.id = "Character"."scriptId"
      and s."userId" = (select auth.uid())::text
  ));
create policy "character delete via script" on public."Character"
  for delete to authenticated
  using (exists (
    select 1 from public."Script" s
    where s.id = "Character"."scriptId"
      and s."userId" = (select auth.uid())::text
  ));

drop policy if exists "clue select via script" on public."ClueCard";
drop policy if exists "clue insert via script" on public."ClueCard";
drop policy if exists "clue update via script" on public."ClueCard";
drop policy if exists "clue delete via script" on public."ClueCard";
create policy "clue select via script" on public."ClueCard"
  for select to authenticated
  using (exists (
    select 1 from public."Script" s
    where s.id = "ClueCard"."scriptId"
      and (s."userId" = (select auth.uid())::text or s.source = 'BUILTIN')
  ));
create policy "clue insert via script" on public."ClueCard"
  for insert to authenticated
  with check (exists (
    select 1 from public."Script" s
    where s.id = "ClueCard"."scriptId"
      and s."userId" = (select auth.uid())::text
  ));
create policy "clue update via script" on public."ClueCard"
  for update to authenticated
  using (exists (
    select 1 from public."Script" s
    where s.id = "ClueCard"."scriptId"
      and s."userId" = (select auth.uid())::text
  ))
  with check (exists (
    select 1 from public."Script" s
    where s.id = "ClueCard"."scriptId"
      and s."userId" = (select auth.uid())::text
  ));
create policy "clue delete via script" on public."ClueCard"
  for delete to authenticated
  using (exists (
    select 1 from public."Script" s
    where s.id = "ClueCard"."scriptId"
      and s."userId" = (select auth.uid())::text
  ));

drop policy if exists "own session select" on public."GameSession";
drop policy if exists "own session insert" on public."GameSession";
drop policy if exists "own session update" on public."GameSession";
drop policy if exists "own session delete" on public."GameSession";
create policy "own session select" on public."GameSession"
  for select to authenticated
  using ((select auth.uid())::text = "userId");
create policy "own session insert" on public."GameSession"
  for insert to authenticated
  with check ((select auth.uid())::text = "userId");
create policy "own session update" on public."GameSession"
  for update to authenticated
  using ((select auth.uid())::text = "userId")
  with check ((select auth.uid())::text = "userId");
create policy "own session delete" on public."GameSession"
  for delete to authenticated
  using ((select auth.uid())::text = "userId");

drop policy if exists "session character via session" on public."SessionCharacter";
create policy "session character via session" on public."SessionCharacter"
  for all to authenticated
  using (exists (
    select 1 from public."GameSession" gs
    where gs.id = "SessionCharacter"."sessionId"
      and gs."userId" = (select auth.uid())::text
  ))
  with check (exists (
    select 1 from public."GameSession" gs
    where gs.id = "SessionCharacter"."sessionId"
      and gs."userId" = (select auth.uid())::text
  ));

drop policy if exists "message via session" on public."Message";
create policy "message via session" on public."Message"
  for all to authenticated
  using (exists (
    select 1 from public."GameSession" gs
    where gs.id = "Message"."sessionId"
      and gs."userId" = (select auth.uid())::text
  ))
  with check (exists (
    select 1 from public."GameSession" gs
    where gs.id = "Message"."sessionId"
      and gs."userId" = (select auth.uid())::text
  ));

drop policy if exists "vote via session" on public."Vote";
create policy "vote via session" on public."Vote"
  for all to authenticated
  using (exists (
    select 1 from public."GameSession" gs
    where gs.id = "Vote"."sessionId"
      and gs."userId" = (select auth.uid())::text
  ))
  with check (exists (
    select 1 from public."GameSession" gs
    where gs.id = "Vote"."sessionId"
      and gs."userId" = (select auth.uid())::text
  ));

drop policy if exists "clue release via session" on public."ClueRelease";
create policy "clue release via session" on public."ClueRelease"
  for all to authenticated
  using (exists (
    select 1 from public."GameSession" gs
    where gs.id = "ClueRelease"."sessionId"
      and gs."userId" = (select auth.uid())::text
  ))
  with check (exists (
    select 1 from public."GameSession" gs
    where gs.id = "ClueRelease"."sessionId"
      and gs."userId" = (select auth.uid())::text
  ));
