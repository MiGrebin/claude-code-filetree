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
