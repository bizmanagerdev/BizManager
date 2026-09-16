# Working rules for this repo

## Never commit or push without asking first

Do not run `git commit` or `git push` until the user has explicitly approved
**that specific batch of changes**. This is not negotiable and has no
exceptions.

It applies:

- **In auto / autonomous mode.** Running unattended is not permission. If the
  user is not there to approve, the correct resting state is uncommitted
  changes in the working tree, and the turn ends with a description of them.
- **Per commit, not per task or per session.** "Commit and continue" approves
  the commit in front of you. It does not approve the next one, however
  obviously correct it looks or however few minutes later it arrives.
- **When the user approved the WORK but not the COMMIT.** "Yes, I need that"
  or "do it" is approval to build. It is not approval to record it in history.
  Build it, verify it, describe it, stop.
- **Inside a tight iteration loop** (fix → verify → fix again). That is exactly
  when it is tempting to treat an earlier yes as standing permission. It is
  not.

**Why it matters to this user:** he reviews the work on screen before it is
recorded, and usually wants more iterations first. A premature commit puts an
unfinished design into the history of a repo he has to live with.

**What to do instead:** finish the work, run typecheck / lint / tests, then say
what changed and what the proposed commit would be. Wait. When he does say to
commit, propose the grouping and the exact message, and commit only what was
approved — never sweep in unrelated working-tree changes.

See also the persistent memory note `feedback-ask-before-committing`.
