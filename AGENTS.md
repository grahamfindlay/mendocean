# Agent instructions

## Completing a PR merge and deployment

When the user asks to merge a PR into `main` and deploy it, updating the primary local `main` checkout is part of completing the request. After confirming that the PR is merged and the deployment succeeded:

1. Use `git worktree list` to locate the checkout on `main`; do not assume the task's worktree is the primary checkout.
2. Preserve any uncommitted tracked and untracked work before updating. If a stash is needed, give it a descriptive name, retain it, and tell the user where their work was saved. Do not discard changes or overwrite divergent local commits.
3. Fetch `origin`, then fast-forward the primary checkout with `git merge --ff-only origin/main`.
4. Verify that local `main` matches the fetched `origin/main` and contains the merged PR commit.
5. Include the local `main` update and commit in the completion report, along with deployment verification and any saved local changes.

If the local update cannot be completed safely, explain the remaining blocker; do not report the entire merge-and-deploy request as complete.
