---
description: Commit staged/modified changes with a detailed message and push, no AI co-author attribution
---

# Commit and Push

## Steps

1. Run `git status` and `git diff` (and `git diff --staged` if anything is already staged) to see all changes.
2. Format, lint, typecheck and test whatever's actually touched, before staging anything:
   - Always run `npm run format` first (Prettier, configured in `.prettierrc.json`),
     then `npm run format:check` to confirm nothing is left.
   - Any `src/**/*.{ts,tsx}`, `tests/**`, `vite.config.ts`, `vitest.config.ts`,
     or `tsconfig*.json` changed: `npm run lint`, then `npm run build` (runs
     `tsc` then `vite build`), then `npm test` (unit tests).
   - Any `package.json` / `package-lock.json` changed: run `npm ci` first so the
     lockfile is verified to match, then the checks above.
   - `npm run test:integration` talks to a real Snapserver and changes its
     state; only run it when the change touches `tests/integration/` or the
     protocol code in `src/snapcontrol.ts`.
   - If formatting rewrote a file, or any check reports an error, fix it and
     re-run before continuing.
   - `.prettierignore` skips `dist/`, `coverage/`, `package-lock.json`, `.claude/`
     and Markdown files — don't pass explicit paths that would format those.
   - ESLint already ignores `dist/` and `coverage/`
     (`eslint.config.js`) — don't pass explicit paths that would pull those in.
3. If nothing is staged, stage all relevant modified/new files with `git add`.
4. Write a **detailed** commit message:
   - Subject line: concise summary of the change (imperative mood, e.g. "Add", "Fix", "Refactor").
   - Body: explain _what_ changed and _why_, as bullet points if there are multiple distinct changes.
   - Base the message only on the actual diff — do not include conversational back-and-forth, dead ends, or trial-and-error from the session.
5. Create the commit using a HEREDOC so formatting is preserved, e.g.:
   ```bash
   git commit -m "$(cat <<'EOF'
   Short summary of the change

   - Detail one
   - Detail two
   - Why this change was made
   EOF
   )"
   ```
6. **Do not** add any AI attribution — no `🤖 Generated with Claude Code` line, no `Co-Authored-By: Claude` trailer, no mention of Claude/AI anywhere in the message.
7. Push the commit to the current branch's remote (`git push`, or `git push -u origin <branch>` if it has no upstream yet).
8. Confirm success by showing `git log -1` and `git status` after pushing.

## Rules

- Never include Claude/AI co-authorship or attribution in the commit message.
- Always push after committing — don't stop at just the local commit.
- If the push fails (e.g. diverged branch), report the error and ask before force-pushing or rebasing.
- Never commit build output (`dist/`) or local `.env` changes, such as a `VITE_APP_GITREV`.
