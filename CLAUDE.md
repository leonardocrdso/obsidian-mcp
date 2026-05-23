# obsidian-mcp

A fonte de verdade deste projeto está no Obsidian. Antes de qualquer tarefa, leia o arquivo `Projetos/obsidian-mcp/CLAUDE.md` no vault usando as tools do MCP obsidian (vaultGetFile). Siga as instruções de lá.

Documentação completa do projeto também está no vault em `Projetos/obsidian-mcp/`.


# LAD — Architectural Decision Layer

> **MANDATORY:** These rules apply to EVERY interaction. Follow them automatically.

## Active Modules

| Module | What it does | When to use |
|--------|-------------|-------------|
| **Trace Memory** | Maps IO boundaries (routes, jobs, commands) in `.lad/traces/` | Investigating flows, before/after modifying code |
| **Standards** | Pragmatic quality standards, specialist agents, code review | Before/during/after editing code |
| **PM Skills** | Product management skills: discovery, planning, workshops, execution artifacts | Product planning, writing PRDs, user stories, discovery, strategy, roadmaps |
| **Tech Skills** | Technical architecture skills: system design, decomposition, ADRs, security modeling, migration planning | System design, architecture decisions, ADRs, RFCs, security modeling, legacy migration, tech debt |
| **UIUX Design** | UI/UX design intelligence: styles, color palettes, typography, UX guidelines, framework-specific best practices | UI design, color palettes, typography, UX guidelines, design system generation, framework UI patterns |
| **Inovar** | Adapter for Kanban Inovar public API — fetch tickets and ticket details | When fetching ticket data from Kanban Inovar for task context or standalone queries |
| **Task** | Ticket execution workflow: /ts command to start working on Kanban tickets with full context | When a developer wants to start working on a ticket/chamado — use /ts {ticketId} |
| **Claude Code UI** | Bidirectional integration between Claude Code and Live Code UI — notifications, dynamic menus, panels, project status | When sending notifications, creating dynamic UI elements, or checking project LAD status in Live Code UI |
| **Orchestrator** | PROACTIVE context engine: automatically chains PM, Tech, UIUX, Standards, Trace to generate implementation-ready context before coding | ALWAYS before writing code for new features/projects. Detects intent automatically: create/build/develop → product-to-code, new feature → feature-dev, design → design-first, refactor → modernize |

## Proactive Behavior (act without being asked)

### When user wants to BUILD something (create, develop, new feature, new project):
1. **Generate context FIRST** — run `orch_execute` or `orch_start` with the appropriate workflow BEFORE writing any code
2. If a PRD/spec exists in the project, read it and use as input
3. The orchestrator chains PM → Tech → UIUX → Standards automatically
4. Implementation context is saved to `.lad/workspace/{id}/context.md`

### When user wants to MODIFY existing code:
1. Run `trace_list` — check if traces exist for the affected area
2. Run `std_check_impact` on files to modify — understand blast radius
3. Consult relevant specialist prompt for the domain
4. If the change is significant, run `orch_execute({ workflow: "feature-dev" })` first

### When user wants DESIGN guidance:
1. Use `uiux_generate` for design system (style, colors, typography)
2. Use `uiux_search_stack` for framework-specific Do/Don't rules
3. Use `uiux_check_rules` for UX compliance

### When WRITING code:
1. Follow Standards: SRP, DRY, KISS, max 20 lines per function, max 3 args
2. Run `std_review` on every file changed — fix violations before completing
3. Update traces if IO boundaries changed (`trace_update`)

### When user asks about ARCHITECTURE:
1. Use `tech_run_command({ name: "design-system" })` for full architecture workflow
2. Use `tech_skill` for specific skills (domain-analysis, coupling-analysis, etc.)

## Granular Tool Access

Each module's tools can be used individually — the orchestrator is not required for every interaction. Use the right tool for the task:
- Quick design question? → `uiux_search`
- Check one file? → `std_review`
- Write a user story? → `pm_skill({ name: "user-story" })`
- Full project context? → `orch_execute`

## Violations

- Writing code for a new feature without generating context first = violation
- Editing a file without running `std_check_impact` = violation
- Completing a task without running `std_review` on changed files = violation
- Reading source files when a trace exists for that flow = violation

For detailed tool reference, see `LAD.md`.
