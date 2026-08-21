---
name: project-tracker
description: Adds or updates entries in the personal project tracker board at project-tracker/index.html, which lists the user's in-progress, needs-edit, stalled, and finished projects. Use this whenever the user starts a new project and wants it tracked, mentions a project needs a status update, or asks in Arabic or English to add/update/organize a project — e.g. "مشروع جديد", "أضف مشروع", "ضيف هذا المشروع", "سجل هذا المشروع", "حدث صفحة المشاريع", "نظم مشاريعي", "new project", "track this", "update the project tracker", "mark this project as done/stalled/needs edit".
---

# Project tracker skill

This repo has a small static board at `project-tracker/index.html` that the user
uses to keep track of every project they're working on so they don't lose track
of what's in progress, what needs edits, and what's stalled.

The page's permanent data lives in the `BASE_PROJECTS` array near the top of the
`<script>` block in that file. (The page also layers per-browser edits on top via
`localStorage` — never touch that logic; it's client-side only. Always edit
`BASE_PROJECTS` directly, since that's the part that's committed and shared.)

Each entry looks like:

```js
{id:'kebab-case-id', name:'اسم المشروع', status:'in_progress', description:'...', notes:'', link:'', updatedAt:'YYYY-MM-DD'}
```

`status` must be one of: `in_progress`, `needs_edit`, `stalled`, `done`.

## Adding a new project

1. Open `project-tracker/index.html` and find the `BASE_PROJECTS` array.
2. Build an `id`: a short kebab-case slug derived from the project name (lowercase,
   hyphens, ASCII only — e.g. `"متجر الأدوات"` → `mtjr-aladwat` or just transliterate
   loosely; uniqueness matters more than prettiness). Make sure it doesn't collide
   with an existing id.
3. Fill in the fields:
   - `name` — required.
   - `status` — default to `in_progress` unless context says otherwise (e.g. the
     user says it needs fixing → `needs_edit`; hasn't been touched in a while and
     they call it stuck → `stalled`).
   - `description` — one short line on what the project is. Infer it from context
     (what you were just building/discussing) rather than asking, when it's obvious.
   - `notes` — optional; use it for "where I left off" type info if known.
   - `link` — optional repo URL, folder path, or file path if there is an obvious one.
   - `updatedAt` — today's date, `YYYY-MM-DD`.
4. Only ask the user a clarifying question if the project name or status genuinely
   isn't clear from context — don't interrupt the flow for optional fields.
5. Append the object to `BASE_PROJECTS` and save the file.

## Updating an existing project

Find the matching object by `name` or `id`, update the changed fields (status,
notes, description, link), and bump `updatedAt` to today.

## Proactive use

If you notice the user has clearly started a new, nontrivial project that isn't
in the tracker yet (new project scaffolded, a distinct effort separate from what's
already tracked), it's fine to proactively add it — but say a short one-line
heads-up when you do ("ضفتلك المشروع في صفحة المشاريع") rather than doing it silently.

## Committing

This only edits a local file. Whether to commit/push depends on the surrounding
task — follow whatever git workflow already applies to the current session/repo.
Don't invent a separate commit just for a trivial one-line tracker update if the
user is mid-task on something else; fold it into the natural next commit, or ask
if unsure.
