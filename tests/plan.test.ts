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
