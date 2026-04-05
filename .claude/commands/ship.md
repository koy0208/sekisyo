Git commit and push in one step.

Follow these steps:

1. Run `git status` (never use -uall) and `git diff --staged` and `git diff` and `git log --oneline -5` in parallel to understand the current state.

2. If there are no changes (no untracked files, no modifications, no staged changes), tell the user there is nothing to commit and stop.

3. If there are unstaged or untracked changes, stage the relevant files. Prefer `git add <specific files>` over `git add -A`. Do NOT stage files that likely contain secrets (.env, credentials.json, etc).

4. Analyze all staged changes and draft a commit message following Conventional Commits format (`feat:`, `fix:`, `refactor:`, `style:`, `docs:`, `chore:`, `test:` etc). The message should:
   - Be concise (1-2 sentences)
   - Focus on the "why" rather than the "what"
   - Match the style of recent commits shown in the log

5. Show the user the proposed commit message and list of files to be committed. Ask for confirmation before proceeding. If the user wants changes, adjust accordingly.

6. Create the commit using a HEREDOC for the message:
   ```
   git commit -m "$(cat <<'EOF'
   <commit message>
   EOF
   )"
   ```

7. If the commit fails due to a pre-commit hook, fix the issue and create a NEW commit (do not amend).

8. Push to the remote. If the current branch has no upstream, use `git push -u origin <branch>`. Otherwise use `git push`.

9. Report the result: commit hash, branch, and remote URL if available.

Important:
- NEVER amend existing commits unless explicitly asked
- NEVER force push
- NEVER skip hooks (--no-verify)
- NEVER push to main/master without confirming with the user first
- If pushing to main/master, warn the user and ask for explicit confirmation
