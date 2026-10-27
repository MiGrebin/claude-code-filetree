# Plan-Fortschritt im Files-Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganz unten im Files-Pane von filetree werden die Tasks des gerade ausgeführten superpowers-Plans angezeigt: erledigte mit ✓, die aktuelle mit ▶, offene mit ○.

**Architecture:** Reine Funktionen in `hooks/plan.ts` lesen die Plan-Datei, ordnen Claudes Tasks den Plan-Tasks zu und berechnen das sichtbare Fenster. `hooks/progress.ts` liest die Tool-Calls des Hauptloops mit (`Read`/`Write`/`Edit` auf Plan-Dateien, `Skill`, `TaskCreate`, `TaskUpdate`, `TodoWrite`), hält den Zustand in `$.state` (`filetree.plan`) und hängt per `prompt.compose` einen Hinweis an den System-Prompt. `hooks/register.tsx` zeichnet den Bereich unter der Fußzeile des Panes und gibt dafür Zeilen des Baums ab.

**Tech Stack:** Claude-Code-Mod (TypeScript/TSX, Engine-API `claude-code`, Tests mit `claude-code/testing` unter `claude plugin test`), Claude Code 2.1.311, bun 1.3 nur für `scripts/contrast.ts`

**Spec:** `docs/superpowers/specs/2026-10-27-plan-progress-design.md`

## Global Constraints

- Arbeitsverzeichnis `~/Work/claude-code-filetree`, Branch `feat/plan-progress`. Der PR geht später gegen `main` von `MiGrebin/claude-code-filetree` (`gh pr create --repo MiGrebin/claude-code-filetree --base main`), nie an upstream.
- Tests immer mit `command claude plugin test .` ausführen. `claude` ist in der Shell ein Alias mit `--dangerously-skip-permissions`, und mit diesem Flag verweigert `plugin test` den Dienst. `bun test` darf nie verwendet werden (`AGENTS.md`).
- Validieren mit `command claude plugin validate .claude-plugin/plugin.json && command claude plugin validate .claude-plugin/marketplace.json`.
- Farben: nur vorhandene Palette- und Theme-Werte (`addColor`, `theme.accent`, `mutedText`), keine neuen Hex-Werte. `bun scripts/contrast.ts` muss mit `every color passes` enden (`AGENTS.md`).
- Typecheck: `cd /private/tmp/claude-501/-Users-michael-Work/2b3fdbac-9416-4d11-9aad-503b4788e0d9/scratchpad/tscheck && npx -y -p typescript@5.6.3 tsc -p tsconfig.json 2>&1 | grep "error TS" | sed -E 's/^.*claude-code-filetree\/([^(]+)\(.*/\1/' | sort | uniq -c`. Ausgangslage von upstream: genau `8 hooks/register.tsx` und `7 tests/surfaces.test.tsx`. Neue Dateien müssen fehlerfrei sein, die Zahlen dürfen nicht steigen. Fehlt die tsconfig dort, den Skill `plugin-authoring` laden; er legt `claude-code.d.ts` unter `/private/tmp/claude-501/bundled-skills/<version>/<hash>/plugin-authoring/types/` ab, und `include` in der tsconfig muss darauf zeigen.
- Laufzeitumgebung der Mod-Module: kein Node, kein DOM, ES-Module, kein `import()`. Dateien von außen nur über `$.fs`.
- Code-Stil wie im Repo: keine Semikolons, einfache Anführungszeichen, 2 Leerzeichen, `type`-Imports, kaum Kommentare.
- UI-Texte: Kopfzeile `── Plan <erledigt>/<gesamt> · <Titel> ──`, Sammelzeilen `✓ <n> erledigt`, `⋮ <n> davor`, `○ <n> weitere`, Symbole `✓ ▶ ○` immer als Unicode.
- Commits: Conventional Commits, kleingeschrieben, Imperativ, ohne Punkt am Ende, **keine `Co-Authored-By`-Zeilen**. Nur die Dateien des Schritts stagen (`git add <pfade>`). Der pre-commit-Hook (`core.hooksPath .githooks`, schon aktiv) führt bei Änderungen unter `hooks/`, `tests/`, `types/` und `.claude-plugin/` validate und test aus.
- Basis: 125 Tests grün (`Ran 125 tests across 2 files`).

---

## Datei-Übersicht

| Datei | Aufgabe |
| --- | --- |
| `types/index.d.ts` | Typen `PlanStatus`, `PlanTask`, `ClaudeTask`, `Plan`, Contract-Schlüssel `filetree.plan` |
| `hooks/plan.ts` (neu) | reine Funktionen: Plan parsen, zuordnen, Status, Fenster, Texte |
| `hooks/progress.ts` (neu) | State-Ref `PLAN`, `readPlan`, `trackPlan(on)` mit allen Hooks |
| `hooks/register.tsx` | `trackPlan(on)` registrieren, Plan-Bereich im Pane zeichnen |
| `tests/plan.test.ts` (neu) | Tests der reinen Funktionen |
| `tests/surfaces.test.tsx` | Ablauf- und Render-Tests mit dem bestehenden `world`-Harness |
| `.claude-plugin/plugin.json`, `README.md` | Version `0.5.0-plan.1`, Abschnitt zur Fork-Funktion |

---

### Task 1: Plan-Datei parsen und Tasks zuordnen

**Files:**
- Modify: `types/index.d.ts` (neue Typen vor `declare module 'claude-code'`)
- Create: `hooks/plan.ts`
- Test: `tests/plan.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces:
  - in `types/index.d.ts`: `PlanStatus`, `PlanTask { id: string; title: string }`, `ClaudeTask { subject: string; status: PlanStatus; plan: string }`, `Plan { candidate: string; pick: boolean; path: string; title: string; tasks: PlanTask[]; claude: Record<string, ClaudeTask> }`
  - in `hooks/plan.ts`: `isPlanFile(path: string): boolean`, `isExecuteSkill(skill: string): boolean`, `parsePlan(markdown: string, path?: string): { title: string; tasks: PlanTask[] }`, `matchTask(subject: string, tasks: readonly PlanTask[]): string | undefined`

- [ ] **Step 1: Typen ergänzen**

In `types/index.d.ts` direkt nach dem Block `export type Theme = { … }` und vor `declare module 'claude-code' {` einfügen:

```ts
export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export type PlanTask = {
  id: string
  title: string
}

export type ClaudeTask = {
  subject: string
  status: PlanStatus
  plan: string
}

export type Plan = {
  candidate: string
  pick: boolean
  path: string
  title: string
  tasks: PlanTask[]
  claude: Record<string, ClaudeTask>
}
```

- [ ] **Step 2: Failing tests schreiben**

`tests/plan.test.ts` anlegen:

```ts
import { expect, test } from 'claude-code/testing'

import { isExecuteSkill, isPlanFile, matchTask, parsePlan } from '../hooks/plan'

const PLAN = [
  '# Werkbank-API Revisionen – Implementierungsplan (PIM)',
  '',
  '## Global Constraints',
  '## Task-Übersicht',
  '### Task 1: Klassenfelder `revisionOf`',
  '- [ ] **Step 1: Failing test schreiben**',
  '```markdown',
  '### Task 99: Beispiel im Code-Block',
  '```',
  '## Task 2 – Seriennummern und Blöcke',
  '````markdown',
  '```ts',
  '### Task 98: tief im Beispiel',
  '```',
  '````',
  '#### Task P3: Feeds liefern `pl`',
  '### Task 9R: Branch from origin/main',
  '## Aufgaben',
  '## Aufgabe 10: Dialog und Darstellung',
  '#### Teil A – Builder herauslösen',
  '##### Task 11: zu tief',
].join('\n')

const TASKS = [
  { id: '1', title: 'Setup' },
  { id: '2', title: 'Datenmodell `Plan`' },
  { id: 'P3', title: 'API-Endpoint' },
]

test('parsePlan reads the title and every task heading outside code blocks', () => {
  expect(parsePlan(PLAN)).toEqual({
    title: 'Werkbank-API Revisionen',
    tasks: [
      { id: '1', title: 'Klassenfelder `revisionOf`' },
      { id: '2', title: 'Seriennummern und Blöcke' },
      { id: 'P3', title: 'Feeds liefern `pl`' },
      { id: '9R', title: 'Branch from origin/main' },
      { id: '10', title: 'Dialog und Darstellung' },
    ],
  })
})

test('parsePlan strips the plan suffix from the title and falls back to the file name', () => {
  expect(parsePlan('# Auth Refactor Implementation Plan\n### Task 1: A').title).toBe('Auth Refactor')
  expect(parsePlan('# Lager — Implementierungsplan\n### Task 1: A').title).toBe('Lager')
  expect(parsePlan('### Task 1: A', '/r/docs/superpowers/plans/2026-10-27-plan-progress.md').title).toBe('plan-progress')
  expect(parsePlan('no tasks here').tasks).toEqual([])
})

test('isPlanFile and isExecuteSkill recognise superpowers plans and the skills that run them', () => {
  expect(isPlanFile('/r/docs/superpowers/plans/2026-10-27-x.md')).toBe(true)
  expect(isPlanFile('C:\\r\\docs\\superpowers\\plans\\x.md')).toBe(true)
  expect(isPlanFile('/r/docs/superpowers/specs/x.md')).toBe(false)
  expect(isPlanFile('/r/docs/superpowers/plans/sub/x.md')).toBe(false)
  expect(isPlanFile('/r/docs/superpowers/plans/x.txt')).toBe(false)
  for (const skill of ['superpowers:subagent-driven-development', 'subagent-driven-development', 'superpowers:executing-plans', 'executing-plans']) expect(isExecuteSkill(skill)).toBe(true)
  for (const skill of ['superpowers:writing-plans', 'superpowers:brainstorming', 'executing-plans-extra']) expect(isExecuteSkill(skill)).toBe(false)
})

test('matchTask finds the plan task by its number first, then by its exact title', () => {
  expect(matchTask('Task 1: Setup', TASKS)).toBe('1')
  expect(matchTask('Implement task p3', TASKS)).toBe('P3')
  expect(matchTask('Aufgabe 2', TASKS)).toBe('2')
  expect(matchTask('Task 7: Datenmodell Plan', TASKS)).toBe('2')
  expect(matchTask('datenmodell plan', TASKS)).toBe('2')
  expect(matchTask('Final review', TASKS)).toBeUndefined()
  expect(matchTask('Setup the database', TASKS)).toBeUndefined()
  expect(matchTask('Review all tasks 1-3', TASKS)).toBeUndefined()
  expect(matchTask('', TASKS)).toBeUndefined()
})
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd ~/Work/claude-code-filetree && command claude plugin test . 2>&1 | tail -15`
Expected: FAIL. `tests/plan.test.ts` kann `../hooks/plan` nicht auflösen, die bestehenden 125 Tests bleiben grün.

- [ ] **Step 4: `hooks/plan.ts` implementieren**

```ts
import type { PlanTask } from '../types'

const PLAN_FILE = /\/docs\/superpowers\/plans\/[^/]+\.md$/
const EXECUTE_SKILL = /^(?:superpowers:)?(?:subagent-driven-development|executing-plans)$/
const HEADING = /^#{2,4}\s+(?:Task|Aufgabe)\s+([A-Za-z]?\d+[A-Za-z]?)\s*[:.–—-]\s*(.+?)\s*$/
const FENCE = /^\s*(`{3,}|~{3,})/
const MENTION = /\b(?:Task|Aufgabe)\s+([A-Za-z]?\d+[A-Za-z]?)\b/i
const PREFIX = /^\s*(?:Task|Aufgabe)\s+[A-Za-z]?\d+[A-Za-z]?\s*[:.–—-]?\s*/i
const SUFFIX = /\s*[–—-]?\s*(?:Implementation Plan|Implementierungsplan)\s*(?:\([^)]*\))?\s*$/i

export function isPlanFile(path: string): boolean {
  return PLAN_FILE.test(path.replace(/\\/g, '/'))
}

export function isExecuteSkill(skill: string): boolean {
  return EXECUTE_SKILL.test(skill.trim())
}

export function parsePlan(markdown: string, path = ''): { title: string; tasks: PlanTask[] } {
  let title = ''
  let fence = ''
  const tasks: PlanTask[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const mark = FENCE.exec(line)?.[1]
    if (mark) {
      if (!fence) fence = mark
      else if (mark[0] === fence[0] && mark.length >= fence.length && /^\s*[`~]+\s*$/.test(line)) fence = ''
      continue
    }
    if (fence) continue
    if (!title && /^#\s+/.test(line)) title = line.replace(/^#\s+/, '').replace(SUFFIX, '').trim()
    const m = HEADING.exec(line)
    if (m?.[1] && m[2]) tasks.push({ id: m[1], title: m[2] })
  }
  return { title: title || fileTitle(path), tasks }
}

function fileTitle(path: string): string {
  return (path.replace(/\\/g, '/').split('/').pop() ?? '').replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')
}

export function matchTask(subject: string, tasks: readonly PlanTask[]): string | undefined {
  const id = MENTION.exec(subject)?.[1]?.toLowerCase()
  const byId = id ? tasks.find(t => t.id.toLowerCase() === id) : undefined
  if (byId) return byId.id
  const want = normalize(subject.replace(PREFIX, ''))
  return want ? tasks.find(t => normalize(t.title) === want)?.id : undefined
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`'"„“”‚‘’.,:;!?()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cd ~/Work/claude-code-filetree && command claude plugin test . 2>&1 | tail -4`
Expected: PASS, `129 pass`, `0 fail`, `Ran 129 tests across 3 files`.

- [ ] **Step 6: Typecheck**

Run: der Typecheck-Befehl aus den Global Constraints
Expected: nur `8 hooks/register.tsx` und `7 tests/surfaces.test.tsx`, nichts zu `hooks/plan.ts`, `tests/plan.test.ts` oder `types/index.d.ts`.

- [ ] **Step 7: Commit**

```bash
cd ~/Work/claude-code-filetree
git add types/index.d.ts hooks/plan.ts tests/plan.test.ts
git commit -m "feat(plan): parse superpowers plans and match tasks to them"
```

---

### Task 2: Status, Fenster und Texte des Plan-Bereichs

**Files:**
- Modify: `hooks/plan.ts`
- Test: `tests/plan.test.ts`

**Interfaces:**
- Consumes: `parsePlan`, `matchTask`, Typen `Plan`, `PlanStatus`, `PlanTask` (Task 1)
- Produces (alle in `hooks/plan.ts`):
  - `type TaskLine = { kind: 'task'; task: PlanTask; status: PlanStatus }`
  - `type SummaryLine = { kind: 'before' | 'after'; count: number; allDone: boolean }`
  - `type PlanLine = TaskLine | SummaryLine`
  - `const PLAN_GLYPH: Record<PlanStatus, string>`
  - `statuses(plan: Plan): Record<string, PlanStatus>`
  - `doneCount(tasks: readonly PlanTask[], status: Readonly<Record<string, PlanStatus>>): number`
  - `planWindow(tasks: readonly PlanTask[], status: Readonly<Record<string, PlanStatus>>, rows: number): PlanLine[]`
  - `summaryLabel(line: SummaryLine): string`
  - `planHeading(done: number, total: number, title: string, width: number): { label: string; rest: string }`
  - `planHint(path: string): string`

- [ ] **Step 1: Failing tests schreiben**

In `tests/plan.test.ts` die Importe ersetzen durch:

```ts
import { expect, test } from 'claude-code/testing'

import type { Plan, PlanStatus, PlanTask } from '../types'
import { doneCount, isExecuteSkill, isPlanFile, matchTask, parsePlan, type PlanLine, planHeading, planHint, planWindow, statuses, summaryLabel } from '../hooks/plan'
```

und ans Ende der Datei anhängen:

```ts
const plan = (claude: Plan['claude'], path = '/p/a.md'): Plan => ({ candidate: path, pick: false, path, title: 'A', tasks: TASKS, claude })
const many = (n: number): PlanTask[] => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), title: `T${i + 1}` }))
const marks = (n: number, fn: (id: number) => PlanStatus): Record<string, PlanStatus> => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), fn(i + 1)]))
const range = (from: number, to: number, mark: string) => Array.from({ length: to - from + 1 }, (_, i) => `${mark}${from + i}`)
const shape = (lines: PlanLine[]) => lines.map(l => (l.kind === 'task' ? `${l.status[0]}${l.task.id}` : `${l.kind}:${l.count}${l.allDone ? '✓' : ''}`))

test('statuses ranks in_progress over completed over pending and counts only tasks of this plan', () => {
  expect(statuses(plan({
    a: { subject: 'Task 1: Setup', status: 'completed', plan: '/p/a.md' },
    b: { subject: 'Task 1: Setup', status: 'in_progress', plan: '/p/a.md' },
    c: { subject: 'Task 2', status: 'completed', plan: '' },
    d: { subject: 'Task P3', status: 'completed', plan: '/p/old.md' },
    e: { subject: 'Final review', status: 'in_progress', plan: '/p/a.md' },
  }))).toEqual({ '1': 'in_progress', '2': 'completed', P3: 'pending' })
  expect(doneCount(TASKS, { '1': 'completed', '2': 'in_progress', P3: 'completed' })).toBe(2)
})

test('planWindow shows every task that fits and otherwise a window around the current task', () => {
  expect(shape(planWindow(many(5), {}, 12))).toEqual(range(1, 5, 'p'))
  expect(shape(planWindow(many(35), marks(35, i => (i <= 20 ? 'completed' : i === 21 ? 'in_progress' : 'pending')), 12)))
    .toEqual(['before:19✓', 'c20', 'i21', ...range(22, 29, 'p'), 'after:6'])
  expect(shape(planWindow(many(35), {}, 12))).toEqual([...range(1, 11, 'p'), 'after:24'])
  expect(shape(planWindow(many(35), marks(35, () => 'completed'), 12))).toEqual(['before:24✓', ...range(25, 35, 'c')])
  expect(shape(planWindow(many(35), marks(35, i => (i === 1 ? 'completed' : i === 2 ? 'in_progress' : 'pending')), 12)))
    .toEqual(['c1', 'i2', ...range(3, 11, 'p'), 'after:24'])
  expect(shape(planWindow(many(10), marks(10, i => (i <= 5 ? 'completed' : i === 6 ? 'in_progress' : 'pending')), 3)))
    .toEqual(['before:5✓', 'i6', 'after:4'])
  expect(shape(planWindow(many(35), marks(35, i => (i === 2 ? 'pending' : i < 20 ? 'completed' : i === 20 ? 'in_progress' : 'pending')), 12)))
    .toEqual(['before:18', 'c19', 'i20', ...range(21, 28, 'p'), 'after:7'])
})

test('summaryLabel, planHeading and planHint word the plan section', () => {
  expect(summaryLabel({ kind: 'before', count: 19, allDone: true })).toBe('✓ 19 erledigt')
  expect(summaryLabel({ kind: 'before', count: 3, allDone: false })).toBe('⋮ 3 davor')
  expect(summaryLabel({ kind: 'after', count: 6, allDone: false })).toBe('○ 6 weitere')
  expect(summaryLabel({ kind: 'after', count: 2, allDone: true })).toBe('✓ 2 erledigt')
  const wide = planHeading(2, 5, 'Auth-Refactor', 40)
  expect(wide.label).toBe('Plan 2/5')
  expect(wide.rest).toStartWith(' · Auth-Refactor ')
  expect(wide.rest).toEndWith('─')
  expect(`── ${wide.label}${wide.rest}`).toHaveLength(40)
  const long = planHeading(0, 3, 'A'.repeat(50), 30)
  expect(long.rest).toBe(` · ${'A'.repeat(14)}… `)
  expect(`── ${long.label}${long.rest}`).toHaveLength(30)
  expect(planHeading(0, 3, 'Titel', 12).rest).toBe(' ')
  const hint = planHint('/r/docs/superpowers/plans/x.md')
  expect(hint).toContain('/r/docs/superpowers/plans/x.md')
  expect(hint).toContain('`Task <id>: <title>`')
  expect(hint).toContain('not a subagent')
})
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd ~/Work/claude-code-filetree && command claude plugin test . 2>&1 | tail -15`
Expected: FAIL. Die Exporte `statuses`, `doneCount`, `planWindow`, `summaryLabel`, `planHeading` und `planHint` fehlen in `hooks/plan.ts`.

- [ ] **Step 3: Implementieren**

In `hooks/plan.ts` die erste Zeile ersetzen durch:

```ts
import type { Plan, PlanStatus, PlanTask } from '../types'

export type TaskLine = { kind: 'task'; task: PlanTask; status: PlanStatus }
export type SummaryLine = { kind: 'before' | 'after'; count: number; allDone: boolean }
export type PlanLine = TaskLine | SummaryLine

export const PLAN_GLYPH: Record<PlanStatus, string> = { completed: '✓', in_progress: '▶', pending: '○' }
```

In der Konstantenliste nach `const SUFFIX = …` ergänzen:

```ts
const RANK: Record<PlanStatus, number> = { pending: 0, completed: 1, in_progress: 2 }
```

Und ans Ende der Datei anhängen:

```ts
export function statuses(plan: Plan): Record<string, PlanStatus> {
  const out: Record<string, PlanStatus> = Object.fromEntries(plan.tasks.map(t => [t.id, 'pending']))
  for (const task of Object.values(plan.claude)) {
    if (task.plan && task.plan !== plan.path) continue
    const id = matchTask(task.subject, plan.tasks)
    if (id !== undefined && RANK[task.status] > RANK[out[id] ?? 'pending']) out[id] = task.status
  }
  return out
}

export function doneCount(tasks: readonly PlanTask[], status: Readonly<Record<string, PlanStatus>>): number {
  return tasks.filter(t => status[t.id] === 'completed').length
}

export function planWindow(tasks: readonly PlanTask[], status: Readonly<Record<string, PlanStatus>>, rows: number): PlanLine[] {
  const lines: TaskLine[] = tasks.map(task => ({ kind: 'task', task, status: status[task.id] ?? 'pending' }))
  const room = Math.max(3, rows)
  const n = lines.length
  if (n <= room) return lines
  let anchor = lines.findIndex(l => l.status === 'in_progress')
  if (anchor < 0) anchor = lines.findIndex(l => l.status !== 'completed')
  if (anchor < 0) anchor = n - 1
  let from = Math.max(0, anchor - (room > 3 ? 1 : 0))
  if (from === 1) from = 0
  const tail = n - room + 1
  if (from >= tail) return [summary('before', lines.slice(0, tail)), ...lines.slice(tail)]
  const to = from + room - (from > 0 ? 2 : 1)
  return [...(from > 0 ? [summary('before', lines.slice(0, from))] : []), ...lines.slice(from, to), summary('after', lines.slice(to))]
}

function summary(kind: SummaryLine['kind'], lines: readonly TaskLine[]): SummaryLine {
  return { kind, count: lines.length, allDone: lines.every(l => l.status === 'completed') }
}

export function summaryLabel(line: SummaryLine): string {
  if (line.allDone) return `✓ ${line.count} erledigt`
  return line.kind === 'before' ? `⋮ ${line.count} davor` : `○ ${line.count} weitere`
}

export function planHeading(done: number, total: number, title: string, width: number): { label: string; rest: string } {
  const label = `Plan ${done}/${total}`
  const free = width - 3 - label.length
  const room = free - 4
  const name = !title || room < 2 ? '' : title.length > room ? `${title.slice(0, room - 1)}…` : title
  const rest = name ? ` · ${name} ` : ' '
  return { label, rest: rest + '─'.repeat(Math.max(0, free - rest.length)) }
}

export function planHint(path: string): string {
  return `A superpowers plan is being executed: ${path}. If you coordinate this plan (not a subagent working on a single task), keep exactly one task per plan task with the subject \`Task <id>: <title>\` (ids as in the plan's headings), set it to in_progress when you start it and completed when it is done.`
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd ~/Work/claude-code-filetree && command claude plugin test . 2>&1 | tail -4`
Expected: PASS, `132 pass`, `0 fail`.

- [ ] **Step 5: Typecheck**

Run: der Typecheck-Befehl aus den Global Constraints
Expected: unverändert nur `8 hooks/register.tsx` und `7 tests/surfaces.test.tsx`.

- [ ] **Step 6: Commit**

```bash
cd ~/Work/claude-code-filetree
git add hooks/plan.ts tests/plan.test.ts
git commit -m "feat(plan): derive task statuses and the visible plan window"
```

---

### Task 3: Tool-Calls mitlesen und Plan-Zustand führen

**Files:**
- Create: `hooks/progress.ts`
- Modify: `types/index.d.ts` (Contract-Schlüssel `plan`)
- Modify: `hooks/register.tsx` (Import und `trackPlan(on)` nach der `Grep`/`Glob`-Schleife, aktuell um Zeile 1961)
- Test: `tests/surfaces.test.tsx` (Importe oben, neue Tests am Ende)

**Interfaces:**
- Consumes: `isPlanFile`, `isExecuteSkill`, `parsePlan`, `planHint`, `statuses` (Task 1/2), `posix` aus `hooks/tree.ts`, `update` aus `claude-code`
- Produces (in `hooks/progress.ts`): `PLAN = { plugin: 'filetree', key: 'plan' } as const`, `readPlan($: EngineInterface): Promise<Plan>` (immer vollständig, leerer Startwert), `trackPlan(on: On): void`

- [ ] **Step 1: Failing tests schreiben**

In `tests/surfaces.test.tsx` unter den bestehenden Importen ergänzen:

```ts
import { statuses } from '../hooks/plan'
import type { Plan } from '../types'
```

Ans Ende der Datei anhängen:

```tsx
const PLAN_ROOT = '/home/k/proj'
const PLANS = `${PLAN_ROOT}/docs/superpowers/plans`
const AUTH_PLAN = `${PLANS}/2026-10-27-auth.md`
const OLD_PLAN = `${PLANS}/2026-09-01-old.md`
const BIG_PLAN = `${PLANS}/2026-10-27-big.md`
const AUTH_MD = ['# Auth Refactor Implementation Plan', '', '### Task 1: Setup', '', '### Task 2: Datenmodell', '', '### Task 3: API-Endpoint', ''].join('\n')
const OLD_MD = ['# Altplan', '', '## Task 1: Alt', '', '## Task 2: Auch alt', ''].join('\n')
const BIG_MD = ['# Big', '', ...Array.from({ length: 35 }, (_, i) => `### Task ${i + 1}: Teil ${i + 1} Ende`)].join('\n')
const RUN_SKILL = 'superpowers:subagent-driven-development'

function planWorld(on: any, ran: Ran, extra: { rootFiles?: [string, 'file' | 'dir'][] } = {}) {
  let id = 0
  return world(on, {
    os: 'linux', env: { HOME: '/home/k' }, cwd: PLAN_ROOT, top: '', status: '', numstat: '',
    dirs: {
      [PLAN_ROOT]: [['docs', 'dir'], ...(extra.rootFiles ?? [])],
      [`${PLAN_ROOT}/docs`]: [['superpowers', 'dir']],
      [`${PLAN_ROOT}/docs/superpowers`]: [['plans', 'dir']],
      [PLANS]: [['2026-09-01-old.md', 'file'], ['2026-10-27-auth.md', 'file'], ['2026-10-27-big.md', 'file']],
    },
    files: { [AUTH_PLAN]: AUTH_MD, [OLD_PLAN]: OLD_MD, [BIG_PLAN]: BIG_MD },
    tool: (e: any) =>
      e.tool === 'TaskCreate' ? { result: { task: { id: String(++id), subject: e.subject } } }
      : e.tool === 'TaskUpdate' ? { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
      : e.tool === 'Skill' ? { result: { success: true, commandName: e.skill } }
      : { result: {} },
  }, ran)
}

async function planOf($: any): Promise<Plan> {
  return (await $.state.get({ plugin: 'filetree', key: 'plan' })).value
}

async function runPlan($: any, clock: any, path = AUTH_PLAN) {
  await $.tool.call({ tool: 'Read', file_path: path })
  await $.tool.call({ tool: 'Skill', skill: RUN_SKILL })
  await clock.settle()
}

test('plan progress: only an executing skill activates a plan, and the task list sets its statuses', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = planWorld(on, [])
  await $.session.start({ cwd: PLAN_ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.tool.call({ tool: 'Read', file_path: AUTH_PLAN } as any)
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:writing-plans' } as any)
  await clock.settle()
  expect((await planOf($))?.path ?? '').toBe('')
  await $.tool.call({ tool: 'Skill', skill: RUN_SKILL } as any)
  await clock.settle()
  const plan = await planOf($)
  expect([plan.path, plan.title, plan.tasks.map(t => t.id)]).toEqual([AUTH_PLAN, 'Auth Refactor', ['1', '2', '3']])
  for (const subject of ['Task 1: Setup', 'Task 2: Datenmodell', 'Task 3: API-Endpoint', 'Final review']) await $.tool.call({ tool: 'TaskCreate', subject, description: '' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '4', status: 'in_progress' } as any)
  await clock.settle()
  expect(statuses(await planOf($))).toEqual({ '1': 'completed', '2': 'in_progress', '3': 'pending' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' } as any)
  await clock.settle()
  expect(statuses(await planOf($))['2']).toBe('pending')
})

test('plan progress: tool calls of subagents change nothing', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = planWorld(on, [])
  await $.session.start({ cwd: PLAN_ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  await runPlan($, clock)
  await $.tool.call({ tool: 'Read', file_path: OLD_PLAN, agentId: 'a1' } as any)
  await $.tool.call({ tool: 'Skill', skill: RUN_SKILL, agentId: 'a1' } as any)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Task 1: Setup', description: '', agentId: 'a1' } as any)
  await clock.settle()
  const plan = await planOf($)
  expect([plan.path, plan.candidate, plan.claude]).toEqual([AUTH_PLAN, AUTH_PLAN, {}])
})

test('plan progress: a newly run plan does not count the old plan tasks, and switching back restores them', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = planWorld(on, [])
  await $.session.start({ cwd: PLAN_ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  await runPlan($, clock)
  await $.tool.call({ tool: 'Read', file_path: AUTH_PLAN } as any)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Task 1: Setup', description: '' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as any)
  await $.tool.call({ tool: 'Write', file_path: OLD_PLAN, content: OLD_MD } as any)
  await clock.settle()
  expect((await planOf($)).path).toBe(AUTH_PLAN)
  await $.tool.call({ tool: 'Skill', skill: RUN_SKILL } as any)
  await clock.settle()
  let plan = await planOf($)
  expect([plan.path, plan.title, statuses(plan)]).toEqual([OLD_PLAN, 'Altplan', { '1': 'pending', '2': 'pending' }])
  await $.tool.call({ tool: 'Read', file_path: AUTH_PLAN } as any)
  await clock.settle()
  plan = await planOf($)
  expect([plan.path, statuses(plan)]).toEqual([AUTH_PLAN, { '1': 'completed', '2': 'pending', '3': 'pending' }])
})

test('plan progress: TodoWrite lists count like tasks', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = planWorld(on, [])
  await $.session.start({ cwd: PLAN_ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  await runPlan($, clock)
  const todo = (content: string, status: string) => ({ content, status, activeForm: content })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Task 1: Setup', 'completed'), todo('Task 2: Datenmodell', 'in_progress'), todo('Final review', 'pending')] } as any)
  await clock.settle()
  expect(statuses(await planOf($))).toEqual({ '1': 'completed', '2': 'in_progress', '3': 'pending' })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Task 1: Setup', 'completed')] } as any)
  await clock.settle()
  expect(statuses(await planOf($))).toEqual({ '1': 'completed', '2': 'pending', '3': 'pending' })
})

test('plan progress: the system prompt asks for one task per plan task only while a plan runs', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = planWorld(on, [])
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
  await $.session.start({ cwd: PLAN_ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect((await $.prompt.compose({})).sections.map((s: any) => s.id)).toEqual(['intro'])
  await runPlan($, clock)
  const sections = (await $.prompt.compose({})).sections
  expect(sections.map((s: any) => [s.id, s.scope])).toEqual([['intro', 'shared'], ['filetree:plan', 'session']])
  expect(sections[1]?.text).toContain(AUTH_PLAN)
  expect(sections[1]?.text).toContain('`Task <id>: <title>`')
})
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd ~/Work/claude-code-filetree && command claude plugin test . 2>&1 | grep -E "fail|pass|✗|Ran" | tail -12`
Expected: FAIL in den fünf neuen `plan progress:`-Tests (der Plan-Zustand bleibt leer, `planOf` liefert `undefined`), alle übrigen Tests grün.

- [ ] **Step 3: Contract-Schlüssel ergänzen**

In `types/index.d.ts` im Block `declare module 'claude-code'` die Zeile `activity: Activity[]` ergänzen zu:

```ts
      activity: Activity[]
      plan: Plan
```

- [ ] **Step 4: `hooks/progress.ts` anlegen**

```ts
import { type BuiltinToolResults, type EngineInterface, type On, update } from 'claude-code'

import type { Plan } from '../types'
import { isExecuteSkill, isPlanFile, parsePlan, planHint } from './plan'
import { posix } from './tree'

export const PLAN = { plugin: 'filetree', key: 'plan' } as const
const EMPTY: Plan = { candidate: '', pick: false, path: '', title: '', tasks: [], claude: {} }

export async function readPlan($: EngineInterface): Promise<Plan> {
  return { ...EMPTY, ...(await $.state.get(PLAN)).value }
}

async function edit($: EngineInterface, fn: (plan: Plan) => Plan): Promise<void> {
  await update($, PLAN, cur => fn({ ...EMPTY, ...cur }))
}

async function activate($: EngineInterface, path: string): Promise<void> {
  let parsed: ReturnType<typeof parsePlan>
  try {
    parsed = parsePlan(String(await $.fs.read(path)), path)
  } catch {
    return
  }
  if (parsed.tasks.length === 0) return
  await edit($, plan => ({ ...plan, path, title: parsed.title, tasks: parsed.tasks }))
}

export function trackPlan(on: On): void {
  for (const tool of ['Read', 'Write', 'Edit'] as const)
    on('tool.call', { tool }, async ($, e, next) => {
      const result = await next(e)
      if (result.deny || result.isError || e.agentId || !('file_path' in e) || typeof e.file_path !== 'string') return result
      const path = posix(e.file_path)
      if (!isPlanFile(path)) return result
      const plan = await readPlan($)
      await edit($, cur => ({ ...cur, candidate: path, pick: false }))
      if (plan.pick || plan.path === path) await activate($, path)
      return result
    })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny || result.isError || e.agentId || e.tool !== 'Skill' || !isExecuteSkill(e.skill)) return result
    await edit($, plan => ({ ...plan, pick: true }))
    const { candidate } = await readPlan($)
    if (candidate) await activate($, candidate)
    return result
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny || result.isError || e.agentId || e.tool !== 'TaskCreate') return result
    const task = (result.result as Partial<BuiltinToolResults['TaskCreate']> | undefined)?.task
    if (!task?.id) return result
    await edit($, plan => ({ ...plan, claude: { ...plan.claude, [task.id]: { subject: task.subject || e.subject, status: 'pending', plan: plan.path } } }))
    return result
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny || result.isError || e.agentId || e.tool !== 'TaskUpdate') return result
    if ((result.result as Partial<BuiltinToolResults['TaskUpdate']> | undefined)?.success === false) return result
    await edit($, plan => {
      const cur = plan.claude[e.taskId]
      if (!cur) return plan
      const claude = { ...plan.claude }
      if (e.status === 'deleted') delete claude[e.taskId]
      else claude[e.taskId] = { ...cur, ...(e.subject ? { subject: e.subject } : {}), ...(e.status ? { status: e.status } : {}) }
      return { ...plan, claude }
    })
    return result
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny || result.isError || e.agentId || e.tool !== 'TodoWrite') return result
    await edit($, plan => {
      const claude = Object.fromEntries(Object.entries(plan.claude).filter(([key]) => !key.startsWith('todo:')))
      e.todos.forEach((todo, i) => {
        const prev = plan.claude[`todo:${i}`]
        claude[`todo:${i}`] = { subject: todo.content, status: todo.status, plan: prev?.subject === todo.content ? prev.plan : plan.path }
      })
      return { ...plan, claude }
    })
    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const { path } = await readPlan($)
    if (!path) return result
    return { sections: [...result.sections, { id: 'filetree:plan', text: planHint(path), scope: 'session' as const }] }
  })
}
```

- [ ] **Step 5: In `register.tsx` registrieren**

Importzeile direkt nach `import { ADD_COLOR, DEL_COLOR, type Palette, parsePalette } from './palette'` einfügen:

```ts
import { trackPlan } from './progress'
```

Nach der Schleife `for (const tool of ['Grep', 'Glob'] as const) on('tool.call', { tool }, … })` (sie endet mit `      return result\n    })`, direkt vor `  on('ui.message', async ($, e, next) => {`) einfügen:

```ts
  trackPlan(on)

```

Prüfen, dass es genau einen Aufruf gibt: `grep -n "trackPlan" hooks/register.tsx` zeigt zwei Zeilen (Import und Aufruf).

- [ ] **Step 6: Tests laufen lassen**

Run: `cd ~/Work/claude-code-filetree && command claude plugin test . 2>&1 | tail -4`
Expected: PASS, `137 pass`, `0 fail`.

- [ ] **Step 7: Validieren und Typecheck**

Run: `cd ~/Work/claude-code-filetree && command claude plugin validate .claude-plugin/plugin.json && command claude plugin validate .claude-plugin/marketplace.json`
Expected: zweimal `✔ Validation passed`. Ein Hinweis auf einen unbekannten `$.state`-Schlüssel `plan` bedeutet, dass Step 3 fehlt.

Run: der Typecheck-Befehl aus den Global Constraints
Expected: unverändert nur `8 hooks/register.tsx` und `7 tests/surfaces.test.tsx`.

- [ ] **Step 8: Commit**

```bash
cd ~/Work/claude-code-filetree
git add hooks/progress.ts hooks/register.tsx types/index.d.ts tests/surfaces.test.tsx
git commit -m "feat(plan): track the running plan and its tasks from tool calls"
```

---

### Task 4: Plan-Bereich im Pane zeichnen

**Files:**
- Modify: `hooks/register.tsx` (Importe, Render-Hook `ui.render` für `Pane`, aktuell Zeilen 2106 bis 2681)
- Test: `tests/surfaces.test.tsx` (neue Tests am Ende)

**Interfaces:**
- Consumes: `readPlan` (Task 3), `statuses`, `doneCount`, `planWindow`, `summaryLabel`, `planHeading`, `PLAN_GLYPH` (Task 2)
- Produces: den gezeichneten Plan-Bereich; keine neuen Exporte

- [ ] **Step 1: Failing tests schreiben**

Ans Ende von `tests/surfaces.test.tsx` anhängen:

```tsx
const MANY_FILES = Array.from({ length: 60 }, (_, i) => [`f${String(i).padStart(2, '0')}.ts`, 'file'] as [string, 'file'])

async function fileRows(ui: any): Promise<number> {
  return new Set(JSON.stringify(await ui.drawn({ in: 'rows' })).match(/f\d\d\.ts/g) ?? []).size
}

test('plan progress: the pane draws the plan below the tree and gives up tree rows for it', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = planWorld(on, [], { rootFiles: MANY_FILES })
  await $.session.start({ cwd: PLAN_ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'terminal', component: 'Pane', requestId: 'filetree', props: paneProps(60) })
  await clock.settle()
  await $.tool.call({ tool: 'Read', file_path: AUTH_PLAN } as any)
  await clock.settle()
  await clock.advance(5_000)
  await clock.settle()
  expect(await texts(ui)).not.toMatch(/Plan \d+\/\d+/)
  const before = await fileRows(ui)
  await $.tool.call({ tool: 'Skill', skill: RUN_SKILL } as any)
  for (const subject of ['Task 1: Setup', 'Task 2: Datenmodell', 'Task 3: API-Endpoint']) await $.tool.call({ tool: 'TaskCreate', subject, description: '' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' } as any)
  await clock.settle()
  const shown = await texts(ui)
  for (const text of ['── ', 'Plan 1/3', ' · Auth Refactor ', '✓ ', '▶ ', '○ ', 'Setup', 'Datenmodell', 'API-Endpoint']) expect(shown).toContain(text)
  expect(await fileRows(ui)).toBe(before - 4)
  await ui.unmount()
})

test('plan progress: a long plan shows a window around the current task with summary rows', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = planWorld(on, [])
  await $.session.start({ cwd: PLAN_ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'terminal', component: 'Pane', requestId: 'filetree', props: paneProps(60) })
  await clock.settle()
  await runPlan($, clock, BIG_PLAN)
  for (let i = 1; i <= 35; i++) await $.tool.call({ tool: 'TaskCreate', subject: `Task ${i}: Teil ${i} Ende`, description: '' } as any)
  for (let i = 1; i <= 20; i++) await $.tool.call({ tool: 'TaskUpdate', taskId: String(i), status: 'completed' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '21', status: 'in_progress' } as any)
  await clock.settle()
  const shown = await texts(ui)
  for (const text of ['Plan 20/35', ' · Big ', '✓ 19 erledigt', 'Teil 20 Ende', 'Teil 21 Ende', 'Teil 29 Ende', '○ 6 weitere']) expect(shown).toContain(text)
  for (const text of ['Teil 19 Ende', 'Teil 30 Ende']) expect(shown).not.toContain(text)
  await ui.unmount()
})

test('plan progress: the desktop pane lists every task of a long plan', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = planWorld(on, [])
  await $.session.start({ cwd: PLAN_ROOT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'desktop', component: 'Pane', requestId: 'filetree', props: paneProps(60) })
  await clock.settle()
  await runPlan($, clock, BIG_PLAN)
  await clock.settle()
  const shown = await texts(ui)
  for (const text of ['Plan 0/35', 'Teil 1 Ende', 'Teil 35 Ende']) expect(shown).toContain(text)
  expect(shown).not.toContain('weitere')
  await ui.unmount()
})
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd ~/Work/claude-code-filetree && command claude plugin test . 2>&1 | grep -E "fail|pass|✗|Ran" | tail -12`
Expected: FAIL in den drei neuen Render-Tests (`Plan 1/3`, `Plan 20/35` und `Plan 0/35` werden nicht gezeichnet), alle übrigen Tests grün.

- [ ] **Step 3: Importe erweitern**

In `hooks/register.tsx` die Zeile `import { trackPlan } from './progress'` ersetzen durch:

```ts
import { doneCount, PLAN_GLYPH, planHeading, planWindow, statuses, summaryLabel } from './plan'
import { readPlan, trackPlan } from './progress'
```

- [ ] **Step 4: Zeilen für den Plan-Bereich reservieren**

Im Render-Hook die Zeile `    const body = e.props.scroll?.bodyRows ?? 40` finden (einmalig, aktuell Zeile 2190) und direkt danach einfügen:

```ts
    const plan = await readPlan($)
    const planStatus = statuses(plan)
    const planLines = plan.path ? planWindow(plan.tasks, planStatus, nativeScroll ? plan.tasks.length : Math.max(3, Math.floor(body / 3) - 1)) : []
    const planRows = planLines.length ? planLines.length + 1 : 0
```

Dann die beiden Zeilen ändern:

```ts
    const chrome = 1 + (searchGap ? 2 : 0) + 1 + (t.top ? (t.branch ? 1 : 0) : showHints ? 1 : 0) + (footer || latest || shortcutsShown || shortcutsSetting === 'auto' ? 1 : 0)
```

wird zu

```ts
    const chrome = planRows + 1 + (searchGap ? 2 : 0) + 1 + (t.top ? (t.branch ? 1 : 0) : showHints ? 1 : 0) + (footer || latest || shortcutsShown || shortcutsSetting === 'auto' ? 1 : 0)
```

und

```ts
    const fixed = splitRows + 1 + (searchGap ? 2 : 0) + 1 + (t.top ? (t.branch ? 1 : 0) : showHints ? 1 : 0) + (footer || latest || shortcutsShown || shortcutsSetting === 'auto' ? 1 : 0)
```

wird zu

```ts
    const fixed = planRows + splitRows + 1 + (searchGap ? 2 : 0) + 1 + (t.top ? (t.branch ? 1 : 0) : showHints ? 1 : 0) + (footer || latest || shortcutsShown || shortcutsSetting === 'auto' ? 1 : 0)
```

- [ ] **Step 5: Den Bereich zeichnen**

Direkt vor der Zeile `    const hidden: [string, () => void][] = [` (einmalig) einfügen:

```tsx
    const planSection = () => {
      const heading = planHeading(doneCount(plan.tasks, planStatus), plan.tasks.length, plan.title, width)
      const idWidth = Math.max(...plan.tasks.map(x => x.id.length))
      const strong = { bold: true, color: theme.accent }
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" height={1} overflow="hidden">
            <Text {...mutedText}>{'── '}</Text>
            <Text bold color={theme.accent}>{heading.label}</Text>
            <Text {...mutedText}>{heading.rest}</Text>
          </Box>
          {planLines.map(line =>
            line.kind === 'task' ? (
              <Box flexDirection="row" height={1} overflow="hidden">
                <Text {...(line.status === 'completed' ? { color: addColor } : line.status === 'in_progress' ? strong : mutedText)}>{`${PLAN_GLYPH[line.status]} `}</Text>
                <Box flexShrink={0}>
                  <Text {...(line.status === 'in_progress' ? strong : mutedText)}>{`${line.task.id.padStart(idWidth)}  `}</Text>
                </Box>
                <Box flexShrink={1} overflow="hidden">
                  <Text {...(line.status === 'in_progress' ? strong : mutedText)} wrap="truncate-end">
                    {line.task.title}
                  </Text>
                </Box>
              </Box>
            ) : (
              <Text {...mutedText} wrap="truncate-end">
                {summaryLabel(line)}
              </Text>
            ),
          )}
        </Box>
      )
    }

```

Und direkt vor der Zeile `        <Box key="hotkeys" height={0} overflow="hidden" flexDirection="row">` (einmalig) einfügen:

```tsx
        {planRows ? planSection() : null}
```

- [ ] **Step 6: Tests laufen lassen**

Run: `cd ~/Work/claude-code-filetree && command claude plugin test . 2>&1 | tail -4`
Expected: PASS, `140 pass`, `0 fail`.

- [ ] **Step 7: Validieren, Kontrast, Typecheck**

Run: `cd ~/Work/claude-code-filetree && command claude plugin validate .claude-plugin/plugin.json && bun scripts/contrast.ts 2>&1 | tail -1`
Expected: `✔ Validation passed` und `every color passes`.

Run: der Typecheck-Befehl aus den Global Constraints
Expected: unverändert nur `8 hooks/register.tsx` und `7 tests/surfaces.test.tsx`.

- [ ] **Step 8: Commit**

```bash
cd ~/Work/claude-code-filetree
git add hooks/register.tsx tests/surfaces.test.tsx
git commit -m "feat(plan): draw the plan progress below the file tree"
```

---

### Task 5: Version und README des Forks

**Files:**
- Modify: `.claude-plugin/plugin.json` (`"version"`)
- Modify: `README.md` (neuer Abschnitt vor `## Settings`)

**Interfaces:**
- Consumes: das fertige Feature aus Task 1 bis 4
- Produces: Version `0.5.0-plan.1`

- [ ] **Step 1: Version setzen**

In `.claude-plugin/plugin.json` die Zeile `"version": "0.5.0",` ersetzen durch `"version": "0.5.0-plan.1",`.

- [ ] **Step 2: Validieren und testen**

Run: `cd ~/Work/claude-code-filetree && command claude plugin validate .claude-plugin/plugin.json && command claude plugin validate .claude-plugin/marketplace.json && command claude plugin test . 2>&1 | tail -3`
Expected: zweimal `✔ Validation passed`, `140 pass`, `0 fail`. Lehnt validate die Version ab, auf `0.5.0-plan1` ausweichen und das in der Commit-Message nennen.

- [ ] **Step 3: Commit**

```bash
cd ~/Work/claude-code-filetree
git add .claude-plugin/plugin.json
git commit -m "chore(release): set fork version 0.5.0-plan.1"
```

- [ ] **Step 4: README-Abschnitt**

In `README.md` direkt vor der Zeile `## Settings` einfügen:

```markdown
### Plan progress (fork)

This fork adds a section at the bottom of the pane while Claude executes a [superpowers](https://github.com/obra/superpowers) plan with `subagent-driven-development` or `executing-plans`:

```text
── Plan 2/5 · Auth Refactor ─────────
✓ 1  Setup
✓ 2  Datenmodell
▶ 3  API-Endpoint
○ 4  UI
○ 5  Tests
```

- The tasks come from the plan's headings (`### Task 3: …`, `## Aufgabe 3: …`, ids like `P2` or `9R`), their state from Claude's task list (`TaskCreate`/`TaskUpdate`, or `TodoWrite`), matched by the task number or the exact title
- A plan only shows after an executing skill ran; plans Claude merely reads or writes stay hidden, and so do calls of subagents
- While a plan runs, a short section in the system prompt asks Claude to name its tasks `Task <id>: <title>`
- Long plans show a window around the current task with `✓ n erledigt` and `○ n weitere` summary rows; the tree gives up as many rows

```

- [ ] **Step 5: Commit**

```bash
cd ~/Work/claude-code-filetree
git add README.md
git commit -m "docs(readme): describe the plan progress section of the fork"
```

---

## Nach dem Plan (nicht Teil der Tasks)

1. `superpowers:finishing-a-development-branch`: Branch pushen, PR mit `gh pr create --repo MiGrebin/claude-code-filetree --base main`, danach `review-tour`.
2. Ausprobieren: `command claude --plugin-dir ~/Work/claude-code-filetree` in einer Test-Session mit deaktiviertem installiertem filetree.
3. Nach dem Merge (durch den User): Marketplace `claude-code-filetree` in `~/.claude/settings.json` (`extraKnownMarketplaces`) und in der Marketplace-Registrierung auf `MiGrebin/claude-code-filetree` umstellen, dann `claude plugin marketplace update claude-code-filetree` und `claude plugin update filetree@claude-code-filetree`.
