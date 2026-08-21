---
name: project-tracker
description: Adds or updates entries in the personal project tracker board at project-tracker/index.html, which lists the user's in-progress, needs-edit, stalled, and finished projects. Use this whenever the user starts a new project and wants it tracked, mentions a project needs a status update, or asks in Arabic or English to add/update/organize a project — e.g. "مشروع جديد", "أضف مشروع", "ضيف هذا المشروع", "سجل هذا المشروع", "حدث صفحة المشاريع", "نظم مشاريعي", "new project", "track this", "update the project tracker", "mark this project as done/stalled/needs edit".
---

# Project tracker skill

This repo has a small static board at `project-tracker/index.html` that the user
uses to keep track of every project they're working on so they don't lose track
of what's in progress, what needs edits, and what's stalled.

The page is fully local: at runtime everything lives in the browser's
`localStorage` (key `pt_projects`) — no server, no GitHub round trip needed for
it to work. The only thing you ever touch is the `SEED_PROJECTS` array near the
top of the `<script>` block. It's a one-way inbox: the page automatically merges
any `SEED_PROJECTS` entry it hasn't seen yet into `localStorage` the next time it
loads, then ignores it — so editing this file is enough for a new project to
show up next time the user opens/refreshes the page, with no push and no extra
step on their end. Never touch the `localStorage`/merge logic itself, only the
`SEED_PROJECTS` array.

Each entry looks like:

```js
{id:'kebab-case-id', name:'اسم المشروع', status:'in_progress', description:'...', notes:'', link:'', updatedAt:'YYYY-MM-DD'}
```

`status` must be one of: `in_progress`, `needs_edit`, `stalled`, `done`.

## Adding a new project

1. Open `project-tracker/index.html` and find the `SEED_PROJECTS` array.
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
5. Append the object to `SEED_PROJECTS` and save the file.

## Updating an existing project

`SEED_PROJECTS` entries only get merged into the browser once, so editing an
entry already merged into a user's `localStorage` won't reach them automatically
— status/notes updates on an already-tracked project should instead be done live
on the page (open it and use the status dropdown / edit button on the card). If
the user asks you to change something and you can't touch their browser, just
tell them to flip it on the page themselves; don't silently edit `SEED_PROJECTS`
for an id that's likely already merged, since it won't do anything.

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
