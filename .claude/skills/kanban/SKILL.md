---
name: kanban
description: Use the agentic-yankiz GitHub Projects v2 Kanban board for fitness-planner issues and PRs. Use when Shaked asks for kanban, backlog, issues, board status, or moving work.
---

# Fitness Planner Kanban

Use the org Kanban workflow for `agentic-yankiz/fitness-planner`.

## Rules

1. Start from the repo GitHub Projects v2 board: `Fitness Planner Kanban`.
2. Prefer the runtime GitHub MCP/app connector for issue, PR, label, comment,
   and Project updates when available.
3. If no connector is available, use `gh` authenticated as `yankihermesapp[bot]`.
4. Every issue and PR must carry `type:*`, `priority:*`, `area:*`, and the
   current `status:*`.
5. Move the Project card on every transition: `Backlog`, `Refine`, `Plan`,
   `Execute`, `In review`, `Done`, or `Blocked`.
6. Never leave completed work in `No Status`.

## Show Board

```bash
gh issue list --repo agentic-yankiz/fitness-planner --state open \
  --json number,title,labels,assignees,url
```

Render issues grouped by their `status:*` label. Closed issues are `Done`.

## Move Work

Use the shared org skill when available:

```bash
/update-kanban <issue-or-pr-number> <column> --repo agentic-yankiz/fitness-planner
```

If the skill is unavailable, update both:
- the GitHub Projects v2 Status field; and
- the matching `status:*` label.

Confirm the move and show the updated item.
