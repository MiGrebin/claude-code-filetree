import { type BuiltinToolResults, type EngineInterface, type On, update } from 'claude-code'

import type { Plan } from '../types'
import { argumentsOf, isExecuteSkill, isPlanFile, parsePlan, planHint, planPaths } from './plan'
import { posix } from './tree'

const PLAN = { plugin: 'filetree', key: 'plan' } as const
const EMPTY: Plan = { candidate: '', pick: false, path: '', title: '', tasks: [], claude: {}, checks: {}, mtime: 0 }

export async function readPlan($: EngineInterface): Promise<Plan> {
  return { ...EMPTY, ...(await $.state.get(PLAN)).value }
}

async function edit($: EngineInterface, fn: (plan: Plan) => Plan): Promise<void> {
  await update($, PLAN, cur => fn({ ...EMPTY, ...cur }))
}

async function activate($: EngineInterface, path: string): Promise<boolean> {
  let parsed: ReturnType<typeof parsePlan>
  let mtime: number
  try {
    mtime = (await $.fs.stat(path)).mtimeMs
    parsed = parsePlan(String(await $.fs.read(path)), path)
  } catch {
    return false
  }
  if (parsed.tasks.length === 0) return false
  await edit($, plan => ({ ...plan, path, title: parsed.title, tasks: parsed.tasks, checks: parsed.checks, mtime }))
  return true
}

// A plan file the main loop read or changed: the candidate, and active after an executing skill.
async function touch($: EngineInterface, path: string): Promise<void> {
  const plan = await readPlan($)
  await edit($, cur => ({ ...cur, candidate: path }))
  if ((plan.pick || plan.path === path) && (await activate($, path))) await edit($, cur => ({ ...cur, pick: false }))
}

// An executing skill ran: the plan its arguments name, else the next plan file read.
async function arm($: EngineInterface, args: string): Promise<void> {
  const [named] = planPaths(args, posix(await $.session.cwd()))
  if (named && (await activate($, named))) {
    await edit($, plan => ({ ...plan, candidate: named, pick: false }))
    return
  }
  await edit($, plan => ({ ...plan, pick: true }))
  const { candidate } = await readPlan($)
  if (candidate) await activate($, candidate)
}

// The active plan changed on disk, e.g. checkboxes ticked by sed.
async function refresh($: EngineInterface): Promise<void> {
  const { path, mtime } = await readPlan($)
  if (!path) return
  const now = await $.fs.stat(path).then(s => s.mtimeMs, () => mtime)
  if (now !== mtime) await activate($, path)
}

export function trackPlan(on: On): void {
  on('tool.call', { tool: ['Read', 'Write', 'Edit'] }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny || result.isError || e.agentId || !('file_path' in e) || typeof e.file_path !== 'string') return result
    const path = posix(e.file_path)
    if (isPlanFile(path)) await touch($, path)
    return result
  })

  // A failed command may still have changed the plan, so only a deny skips it.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny || e.agentId || e.tool !== 'Bash') return result
    for (const path of planPaths(e.command, posix(await $.session.cwd()))) await touch($, path)
    return result
  })

  // A call that writes files, a subagent's too, may have ticked checkboxes in the active plan.
  on('tool.call', { tool: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Agent'] }, async ($, e, next) => {
    const result = await next(e)
    if (!result.deny) await refresh($)
    return result
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny || result.isError || e.agentId || e.tool !== 'Skill' || !isExecuteSkill(e.skill)) return result
    await arm($, e.args ?? '')
    return result
  })

  on('skill.prompt', async ($, e, next) => {
    if (isExecuteSkill(e.skill)) await arm($, argumentsOf(e.text))
    return next(e)
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
