import type { RowSpec, Seg } from './rows'

export type Usage = { path: string; name: string; bytes: number }
export type Tile = Usage & { x0: number; y0: number; x1: number; y1: number }
export type TileLook = { border: string; name: string; size: string; bold: boolean; bg?: string; rank: number }

export const REST = '#rest'
export const CELL_ASPECT = 2
const MIN_AREA = 7 * 2 * CELL_ASPECT * 1.5
const MAX_TILES = 60
const U = 1
const D = 2
const L = 4
const R = 8
const BOX: Record<number, string> = {
  [U]: '│', [D]: '│', [U | D]: '│', [L]: '─', [R]: '─', [L | R]: '─',
  [D | R]: '╭', [D | L]: '╮', [U | R]: '╰', [U | L]: '╯',
  [U | D | R]: '├', [U | D | L]: '┤', [L | R | D]: '┬', [L | R | U]: '┴', [U | D | L | R]: '┼',
}

export function parseDu(text: string, dir: string): { total?: number; items: Usage[] } {
  const items: Usage[] = []
  let total: number | undefined
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t')
    const kb = Number(line.slice(0, tab))
    if (tab < 1 || !Number.isFinite(kb)) continue
    const path = line.slice(tab + 1)
    if (path === dir) total = kb * 1024
    else items.push({ path, name: path.slice(path.lastIndexOf('/') + 1), bytes: kb * 1024 })
  }
  return { total, items }
}

function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0)
  const max = Math.max(...row)
  const min = Math.min(...row)
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
}

function squarify(areas: number[], x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = []
  let i = 0
  while (i < areas.length) {
    const side = Math.min(w, h)
    const row = [areas[i] ?? 0]
    let j = i + 1
    while (j < areas.length && worst([...row, areas[j] ?? 0], side) <= worst(row, side)) row.push(areas[j++] ?? 0)
    const thick = row.reduce((a, b) => a + b, 0) / side
    let off = 0
    for (const a of row) {
      const len = a / thick
      out.push(w >= h ? { x, y: y + off, w: thick, h: len } : { x: x + off, y, w: len, h: thick })
      off += len
    }
    if (w >= h) {
      x += thick
      w -= thick
    } else {
      y += thick
      h -= thick
    }
    i = j
  }
  return out
}

export function layout(usage: Usage[], columns: number, rows: number): Tile[] {
  const w = columns - 1
  const h = (rows - 1) * CELL_ASPECT
  const sorted = usage.filter(u => u.bytes > 0).sort((a, b) => b.bytes - a.bytes)
  const total = sorted.reduce((a, u) => a + u.bytes, 0)
  if (!total || w < 1 || h < 1) return []
  let keep = sorted.findIndex((u, i) => i >= MAX_TILES - 1 || (u.bytes * w * h) / total < MIN_AREA)
  keep = keep < 0 ? sorted.length : Math.max(1, keep)
  const rest = sorted.slice(keep).reduce((a, u) => a + u.bytes, 0)
  const weigh = (u: Usage) => (u.path === REST ? Math.max(u.bytes, (Math.max(MIN_AREA, 8 * Math.min(w, h)) * total) / (w * h)) : u.bytes)
  const shown: Usage[] = sorted.slice(0, keep)
  if (rest > 0) shown.push({ path: REST, name: `+${sorted.length - keep}`, bytes: rest })
  shown.sort((a, b) => weigh(b) - weigh(a))
  const scale = (w * h) / shown.reduce((a, u) => a + weigh(u), 0)
  const rects = squarify(shown.map(u => weigh(u) * scale), 0, 0, w, h)
  return shown.flatMap((u, i) => {
    const r = rects[i]
    if (!r) return []
    const tile = { ...u, x0: Math.round(r.x), x1: Math.round(r.x + r.w), y0: Math.round(r.y / CELL_ASPECT), y1: Math.round((r.y + r.h) / CELL_ASPECT) }
    return tile.x1 > tile.x0 && tile.y1 > tile.y0 ? [tile] : []
  })
}

function fit(s: string, n: number): string {
  const chars = [...s]
  return chars.length <= n ? s : `${chars.slice(0, Math.max(0, n - 1)).join('')}…`
}

export function draw(tiles: Tile[], columns: number, rows: number, look: (t: Tile) => TileLook, label: (t: Tile) => string): RowSpec[] {
  const bits = Array.from({ length: rows }, () => new Array<number>(columns).fill(0))
  const text = Array.from({ length: rows }, () => new Array<string>(columns).fill(' '))
  const style = Array.from({ length: rows }, () => new Array<Omit<Seg, 't'>>(columns).fill({}))
  const looks = new Map(tiles.map(t => [t, look(t)]))
  const order = [...tiles].sort((a, b) => (looks.get(a)?.rank ?? 0) - (looks.get(b)?.rank ?? 0))
  for (const t of order) {
    const lk = looks.get(t) as TileLook
    const tab = t.path
    const cell = (x: number, y: number, st: Omit<Seg, 't'>, ch?: string, bit = 0) => {
      if (y < 0 || y >= rows || x < 0 || x >= columns) return
      if (bit) (bits[y] as number[])[x] = ((bits[y] as number[])[x] ?? 0) | bit
      if (ch !== undefined) (text[y] as string[])[x] = ch
      ;(style[y] as Omit<Seg, 't'>[])[x] = st
    }
    const edge = { c: lk.border, tab }
    for (let x = t.x0; x <= t.x1; x++) for (const y of [t.y0, t.y1]) cell(x, y, edge, undefined, (x > t.x0 ? L : 0) | (x < t.x1 ? R : 0))
    for (let y = t.y0; y <= t.y1; y++) for (const x of [t.x0, t.x1]) cell(x, y, edge, undefined, (y > t.y0 ? U : 0) | (y < t.y1 ? D : 0))
    for (let y = t.y0 + 1; y < t.y1; y++) for (let x = t.x0 + 1; x < t.x1; x++) cell(x, y, { ...(lk.bg ? { bg: lk.bg } : {}), tab }, ' ')
    const inner = t.x1 - t.x0 - 1
    const size = label(t)
    const nameSt = { c: lk.name, b: lk.bold, ...(lk.bg ? { bg: lk.bg } : {}), tab }
    const sizeSt = { c: lk.size, ...(lk.bg ? { bg: lk.bg } : {}), tab }
    const wide = [...t.name].length + 1 + [...size].length <= inner
    const parts: [number, number, string, Omit<Seg, 't'>][] =
      t.y1 - t.y0 > 2 ? [[t.y0 + 1, 0, fit(t.name, inner), nameSt], [t.y0 + 2, 0, fit(size, inner), sizeSt]]
      : wide ? [[t.y0 + 1, 0, t.name, nameSt], [t.y0 + 1, [...t.name].length + 1, size, sizeSt]]
      : [[t.y0 + 1, 0, fit(t.name, inner), nameSt]]
    if (inner < 1 || t.y1 - t.y0 < 2) continue
    for (const [y, from, s, st] of parts) [...s].forEach((ch, i) => cell(t.x0 + 1 + from + i, y, st, ch))
  }
  return bits.map((row, y) => {
    const segs: Seg[] = []
    row.forEach((b, x) => {
      const ch = b ? (BOX[b] ?? ' ') : (text[y]?.[x] ?? ' ')
      const st = style[y]?.[x] ?? {}
      const last = segs[segs.length - 1]
      if (last && last.c === st.c && last.bg === st.bg && Boolean(last.b) === Boolean(st.b) && last.tab === st.tab) last.t += ch
      else segs.push({ t: ch, ...(st.c ? { c: st.c } : {}), ...(st.bg ? { bg: st.bg } : {}), ...(st.b ? { b: true } : {}), ...(st.tab ? { tab: st.tab } : {}) })
    })
    return { id: '', left: segs, right: [] }
  })
}
