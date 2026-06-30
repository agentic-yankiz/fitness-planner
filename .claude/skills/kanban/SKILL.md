---
name: kanban
description: Read GitHub issues and display them as a kanban backlog. Use when Shaked asks "show kanban", "kanban", "show backlog", "what issues are open", "show issues", or "what's in the backlog".
---

# Kanban Board

Display the project's GitHub issues organized as a kanban board with columns for
Backlog, In Progress, and Done.

## One-time setup (run once if `in-progress` label is missing)

```
gh label create "in-progress" --color "#0052cc" --description "Currently being worked on"
```

## Steps

1. Run `gh issue list --state open --limit 50 --json number,title,labels,assignees` to fetch open issues.
2. Run `gh issue list --state closed --limit 10 --json number,title,labels` to fetch recent closed issues.
3. Parse the JSON output and categorize issues:
   - **In Progress**: open and has label `in-progress`
   - **Done**: is closed
   - **Backlog**: open and no `in-progress` label
4. Render a clean kanban view:
   - Use markdown tables for each column (# | Title | Labels | Assignee).
   - Show issue numbers as `#N` links (e.g., `#13`).
   - Omit assignee/labels columns if empty across all issues in that section.
   - Keep it scannable: one row per issue, no word wrap.
5. After the board, offer to move an issue by editing its labels (ask which issue and where).

## Output rules

- Header: `## Kanban Board`
- Section headers: `### Backlog`, `### In Progress`, `### Done`
- Show "(empty)" under a section if there are no issues.
- Keep titles short; truncate with `...` if > 60 chars.
- If a section has issues, show the count in parentheses, e.g., `### Backlog (3)`.
- Do not explain what the board is — just show it.
- End with: "To move an issue, say `move #N to <In Progress|Done|Backlog>`" (if there are any open issues).

## Moving issues

If Shaked says "move #N to <column>":
- **To In Progress**: `gh issue edit N --add-label in-progress` (creates the label if it doesn't exist — see setup above)
- **To Backlog**: `gh issue edit N --remove-label in-progress`
- **To Done**: `gh issue close N`
- Confirm the move and re-render the board.
