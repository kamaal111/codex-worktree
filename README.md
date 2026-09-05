# codex-worktree

Run Codex CLI in an isolated Git worktree. Named worktrees are reusable and
are preserved after Codex exits, so uncommitted work is never auto-deleted.

## Install

```sh
pnpm add --global ./tools/codex-worktree
```

After publishing:

```sh
pnpm add --global codex-worktree
```

## Use

```sh
codex-worktree --name fix-bridge -- "Fix the bridge retry logic"
```

The first run creates `.codex-worktrees/fix-bridge` on branch
`codex/fix-bridge`; repeating it resumes that worktree. Arguments after `--`
are passed unchanged to Codex:

```sh
codex-worktree --name review -- exec --full-auto "Review this project"
```

New worktrees use `origin/HEAD` if available, otherwise `HEAD`. Choose another
base with `--base REF`. List managed worktrees with `codex-worktree --list`.

To remove finished work, run `git worktree remove .codex-worktrees/NAME`, then
`git branch -d codex/NAME`. Uncommitted primary-checkout files are not copied.

## Development

```sh
pnpm test
pnpm quality
pnpm pack --dry-run
```

Development requires Node 26 and pnpm 11.25.0. `bin/dev.mjs` runs the
TypeScript CLI directly on Node 26; the published command runs the compiled
distribution through `bin/run.mjs`.
