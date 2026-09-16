# Agent Instructions

<!-- effect-solutions:start -->

## Effect Best Practices

**Before implementing Effect features**, run `effect-solutions list` and read the relevant guide.

Topics include: services and layers, data modeling, error handling, configuration, testing, HTTP clients, CLIs, observability, and project structure.

**Effect Source Reference:** `~/.local/share/effect-solutions/effect`
Search here for real implementations when docs aren't enough.

<!-- effect-solutions:end -->

## Version Control (Jujutsu)

All version-control operations in this repository must use Jujutsu (`jj`), not Git.

### Commit Format

```
<context>: <message>
```

Examples: `renderer: optimize text cache`, `editor: fix theme transition`

Keep messages lowercase, no periods.

### Workflow

```bash
jj status                    # check changes
jj describe -m "ctx: msg"    # set commit message
jj new                       # create new commit
jj log                       # view history
```

### Rules

- **Every completed TODO = one commit**
- **Never commit code that doesn't compile** - always run `cargo check` first
- **Never push to upstream**
- **Ask before rebasing**
