import { type BuiltinToolResults, type EngineInterface, type On, update } from 'claude-code'

import type { Plan } from '../types'
import { isExecuteSkill, isPlanFile, parsePlan, planHint } from './plan'
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
  try {
    parsed = parsePlan(String(await $.fs.read(path)), path)
  } catch {
    return false
  }
  if (parsed.tasks.length === 0) return false
  await edit($, plan => ({ ...plan, path, title: parsed.title, tasks: parsed.tasks }))
  return true
}

async function arm($: EngineInterface): Promise<void> {
  await edit($, plan => ({ ...plan, pick: true }))
  const { candidate } = await readPlan($)
  if (candidate) await activate($, candidate)
}

export function trackPlan(on: On): void {
  on('tool.call', { tool: ['Read', 'Write', 'Edit'] }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny || result.isError || e.agentId || !('file_path' in e) || typeof e.file_path !== 'string') return result
    const path = posix(e.file_path)
    if (!isPlanFile(path)) return result
    const plan = await readPlan($)
    await edit($, cur => ({ ...cur, candidate: path }))
    if ((plan.pick || plan.path === path) && (await activate($, path))) await edit($, cur => ({ ...cur, pick: false }))
    return result
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny || result.isError || e.agentId || e.tool !== 'Skill' || !isExecuteSkill(e.skill)) return result
    await arm($)
    return result
  })

  on('skill.prompt', async ($, e, next) => {
    if (isExecuteSkill(e.skill)) await arm($)
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
