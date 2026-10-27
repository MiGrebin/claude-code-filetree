import type { Plan, PlanStatus, PlanTask } from '../types'

export type TaskLine = { kind: 'task'; task: PlanTask; status: PlanStatus }
export type SummaryLine = { kind: 'before' | 'after'; count: number; allDone: boolean }
export type PlanLine = TaskLine | SummaryLine

export const PLAN_GLYPH: Record<PlanStatus, string> = { completed: '✓', in_progress: '▶', pending: '○' }

const PLAN_FILE = /\/docs\/superpowers\/plans\/[^/]+\.md$/
const PLAN_TOKEN = /(?:^|\/)docs\/superpowers\/plans\/[^/]+\.md$/
const EXECUTE_SKILL = /^(?:superpowers:)?(?:subagent-driven-development|executing-plans)$/
const HEADING = /^#{2,4}\s+(?:Task|Aufgabe)\s+([A-Za-z]?\d+[A-Za-z]?)\s*[:.–—-]\s*(.+?)\s*$/
const FENCE = /^\s*(`{3,}|~{3,})/
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]/
const MENTION = /\b(?:Task|Aufgabe)\s+([A-Za-z]?\d+[A-Za-z]?)\b/i
const PREFIX = /^\s*(?:Task|Aufgabe)\s+[A-Za-z]?\d+[A-Za-z]?\s*[:.–—-]?\s*/i
const SUFFIX = /\s*[–—-]?\s*\b(?:Implementation Plan|Implementierungsplan)\s*(?:\([^)]*\))?\s*$/i
const RANK: Record<PlanStatus, number> = { pending: 0, completed: 1, in_progress: 2 }

export function isPlanFile(path: string): boolean {
  return PLAN_FILE.test(path.replace(/\\/g, '/'))
}

export function isExecuteSkill(skill: string): boolean {
  return EXECUTE_SKILL.test(skill.trim())
}

export function planPaths(text: string, cwd: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[\s'"`=();&|<>]+/)) {
    const token = raw.replace(/[.,:;!?]+$/, '').replace(/\\/g, '/')
    if (!PLAN_TOKEN.test(token)) continue
    const path = /^(?:\/|[A-Za-z]:\/)/.test(token) ? token : `${cwd.replace(/\/+$/, '')}/${token.replace(/^(?:\.\/)+/, '')}`
    if (!out.includes(path)) out.push(path)
  }
  return out
}

export function argumentsOf(text: string): string {
  return [...text.matchAll(/^ARGUMENTS:[ \t]*(.*)$/gm)].pop()?.[1]?.trim() ?? ''
}

export function parsePlan(markdown: string, path = ''): { title: string; tasks: PlanTask[]; checks: Record<string, [number, number]> } {
  let title = ''
  let fence = ''
  let current: { id: string; level: number } | null = null
  const tasks: PlanTask[] = []
  const checks: Record<string, [number, number]> = {}
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
    const level = /^(#{1,6})\s/.exec(line)?.[1]?.length
    if (m?.[1] && m[2] && level) {
      tasks.push({ id: m[1], title: m[2] })
      checks[m[1]] = [0, 0]
      current = { id: m[1], level }
      continue
    }
    if (current && level !== undefined && level <= current.level) current = null
    const box = CHECKBOX.exec(line)?.[1]
    if (current && box) {
      const [done, total] = checks[current.id] ?? [0, 0]
      checks[current.id] = [done + (box === ' ' ? 0 : 1), total + 1]
    }
  }
  return { title: title || fileTitle(path), tasks, checks }
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

export function statuses(plan: Plan): Record<string, PlanStatus> {
  const out: Record<string, PlanStatus> = Object.fromEntries(plan.tasks.map(t => [t.id, 'pending']))
  for (const task of Object.values(plan.claude)) {
    if (task.plan && task.plan !== plan.path) continue
    const id = matchTask(task.subject, plan.tasks)
    if (id !== undefined && RANK[task.status] > RANK[out[id] ?? 'pending']) out[id] = task.status
  }
  for (const { id } of plan.tasks) {
    const [done, total] = plan.checks[id] ?? [0, 0]
    const ticked: PlanStatus = total > 0 && done === total ? 'completed' : done > 0 ? 'in_progress' : 'pending'
    if (RANK[ticked] > RANK[out[id] ?? 'pending']) out[id] = ticked
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
  const safe = path.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return `A superpowers plan is being executed: ${safe}. Track its progress in that file: as soon as a step is done, tick its checkbox there (\`- [ ]\` → \`- [x]\`), so the plan always shows how far the work is. If you coordinate this plan (not a subagent working on a single task) and task tools are available, also keep exactly one task per plan task with the subject \`Task <id>: <title>\` (ids as in the plan's headings), in_progress while you work on it and completed when it is done.`
}
