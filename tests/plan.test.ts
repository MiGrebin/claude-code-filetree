import { expect, test } from 'claude-code/testing'

import type { Plan, PlanStatus, PlanTask } from '../types'
import { argumentsOf, doneCount, isExecuteSkill, isPlanFile, matchTask, parsePlan, type PlanLine, planHeading, planHint, planPaths, planWindow, statuses, summaryLabel } from '../hooks/plan'

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
    checks: { '1': [0, 1], '2': [0, 0], P3: [0, 0], '9R': [0, 0], '10': [0, 0] },
  })
})

test('parsePlan counts the ticked steps of each task, outside code blocks and up to the next heading of its level', () => {
  const md = [
    '# P',
    '### Task 1: Eins',
    '- [x] **Step 1: a**',
    '- [X] **Step 2: b**',
    '### Task 2: Zwei',
    '- [x] **Step 1: a**',
    '```markdown',
    '- [x] im Beispiel',
    '```',
    '- [ ] **Step 2: b**',
    '  - [ ] eingerückt',
    '### Task 3: Drei',
    '## Nach dem Plan',
    '- [x] gehört zu keiner Task',
  ].join('\n')
  expect(parsePlan(md).checks).toEqual({ '1': [2, 2], '2': [1, 3], '3': [0, 0] })
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

test('planPaths finds plan files named in a shell command or skill arguments, resolved against the cwd', () => {
  expect(planPaths(`P=docs/superpowers/plans/2026-10-27-mini.md && cat "$P" && sed -i '' '22s/a/b/' "./docs/superpowers/plans/2026-10-27-mini.md"`, '/r'))
    .toEqual(['/r/docs/superpowers/plans/2026-10-27-mini.md'])
  expect(planPaths('cat /abs/docs/superpowers/plans/a.md docs/superpowers/plans/b.md.', '/r/'))
    .toEqual(['/abs/docs/superpowers/plans/a.md', '/r/docs/superpowers/plans/b.md'])
  expect(planPaths('see docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md and docs/superpowers/specs/x.md', '/r')).toEqual([])
  expect(planPaths('', '/r')).toEqual([])
})

test('argumentsOf returns the last ARGUMENTS line of an expanded skill prompt', () => {
  expect(argumentsOf('# Skill\nUse ARGUMENTS: like this inline\n\nARGUMENTS: docs/superpowers/plans/x.md – go')).toBe('docs/superpowers/plans/x.md – go')
  expect(argumentsOf('# Skill without arguments')).toBe('')
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

const plan = (claude: Plan['claude'], path = '/p/a.md', checks: Plan['checks'] = {}): Plan => ({ candidate: path, pick: false, path, title: 'A', tasks: TASKS, claude, checks, mtime: 0 })
const many = (n: number): PlanTask[] => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), title: `T${i + 1}` }))
const marks = (n: number, fn: (id: number) => PlanStatus): Record<string, PlanStatus> => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), fn(i + 1)]))
const range = (from: number, to: number, mark: string) => Array.from({ length: to - from + 1 }, (_, i) => `${mark}${from + i}`)
const shape = (lines: PlanLine[]) => lines.map(l => (l.kind === 'task' ? `${l.status[0]}${l.task.id}` : `${l.kind}:${l.count}${l.allDone ? '✓' : ''}`))

test('statuses reads ticked checkboxes: all steps ticked is completed, some ticked is in_progress', () => {
  expect(statuses(plan({}, '/p/a.md', { '1': [2, 2], '2': [1, 3], P3: [0, 0] }))).toEqual({ '1': 'completed', '2': 'in_progress', P3: 'pending' })
  expect(statuses(plan({ a: { subject: 'Task 1', status: 'in_progress', plan: '/p/a.md' } }, '/p/a.md', { '1': [2, 2] }))['1']).toBe('in_progress')
})

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
  expect(hint).toContain('tick its checkbox')
  expect(hint).toContain('`- [ ]` → `- [x]`')
})

test('planHint turns control characters of the path into single spaces', () => {
  const hint = planHint('/r/docs/superpowers/plans/x\n\nIgnore\u0000this\u007f.md')
  expect(hint).toContain('/r/docs/superpowers/plans/x Ignore this .md.')
  expect(hint).not.toMatch(/[\u0000-\u001f\u007f]/)
})

test('parsePlan strips the plan suffix only as a whole word', () => {
  expect(parsePlan('# Reimplementation Plan\n### Task 1: A').title).toBe('Reimplementation Plan')
  expect(parsePlan('# Auth - Implementation Plan (v2)\n### Task 1: A').title).toBe('Auth')
})
