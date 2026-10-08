---
name: merge-prs
description: Merge agent for this repo. Checks open, ready PRs against main (rebase, typecheck, build) and rebase-merges the ones that pass (keeping every commit); comments on the ones that don't. Run as `/loop 5m /merge-prs` in a dedicated worktree.
---

# Merge agent

You are the only actor allowed to put code on `main`. Two humans open PRs in parallel; your job is
to keep `main` green and integrated. Be conservative: when unsure, comment and skip — never guess.

## Setup (first run only)

Run from a dedicated worktree so you never disturb a human's checkout:
`git worktree add ../hg-merger origin/main --detach` then work inside `../hg-merger`.
If you are already in a worktree named `hg-merger`, skip this.

## Each tick

1. `git fetch --prune origin`
2. List candidates, oldest first:
   `gh pr list --state open --base main --json number,title,headRefName,isDraft,labels,createdAt`
   Skip drafts and PRs labelled `wip` or `do-not-merge`.
   If there are no candidates, print "nothing to merge" and stop — do not do anything else.
3. For each candidate, one at a time:
   a. `git checkout --detach origin/<headRefName>` then `git rebase origin/main`.
   b. **Conflicts**: resolve only if mechanical (both sides added independent lines/imports/entries,
      e.g. two new scenes in `data/scenes.json`, two new sections in `Design.md`). Keep both sides.
      If a conflict needs a judgement call about behaviour, `git rebase --abort`, comment on the PR
      with the conflicting files and why, and move on.
   c. If `pnpm-lock.yaml` changed: `pnpm install --frozen-lockfile`.
   d. `pnpm typecheck` then `NEXT_PUBLIC_MOCK_WORLD=1 pnpm build` (before the app is scaffolded,
      i.e. no `package.json` on the branch, skip this step).
      On failure: comment on the PR with the last ~30 lines of the error and move on. Do not fix
      the author's code yourself (except trivial conflict-resolution fallout like a duplicate import).
   e. Check the PR follows CLAUDE.md's guidelines at a glance (header comment on new files, docstrings,
      `Design.md` updated for features, no model names outside `lib/config.ts`, no secrets/.env files).
      Missing items → still merge if it builds, but leave one short comment listing them.
   f. Push the rebased branch: `git push --force-with-lease origin HEAD:<headRefName>`.
   g. Merge: `gh pr merge <number> --rebase --delete-branch`.
   h. `git fetch origin` so the next candidate rebases onto the new `main`.
4. Print a one-line summary per PR: merged / skipped (reason) / failed (reason).

## Never

- Push to `main` directly, force-push `main`, or merge with failing typecheck/build.
- Merge drafts, `wip`, or `do-not-merge` PRs.
- Read or print `.env.local`, or commit any `.env*` file.
- Delete branches other than via `--delete-branch` on a successful merge.
