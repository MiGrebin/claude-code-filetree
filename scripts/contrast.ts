import { LIGHT_TONES, TONES } from '../hooks/git'
import { GIT_COLOR } from '../hooks/icons'
import { ADD_COLOR, DEL_COLOR } from '../hooks/palette'
import { DEFAULT_THEME } from '../hooks/tree'

type Check = { name: string; color: string; min: number }

const DARK_BACKGROUNDS = { black: '#000000', 'vscode dark': '#1e1e1e', 'one dark': '#282c34' }
const LIGHT_BACKGROUNDS = { white: '#ffffff', 'near white': '#fafafa' }
const TEXT = 3
const DIM = 2
const AAA = 7

function luminance(hex: string): number {
  const v = parseInt(hex.slice(1).replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3'), 16)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = [16, 8, 0].map(s => lin(((v >> s) & 255) / 255))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

const PALETTE = [
  ['accent', DEFAULT_THEME.accent],
  ['muted', DEFAULT_THEME.muted],
  ['urgent', DEFAULT_THEME.urgent],
  ['selection', DEFAULT_THEME.selection],
  ['add', ADD_COLOR],
  ['del', DEL_COLOR],
  ...Object.entries(GIT_COLOR).map(([k, color]) => [`git ${k}`, color]),
]

function checks(tones: typeof TONES, text: number, dim: number): Check[] {
  const out: Check[] = []
  for (const [tone, t] of Object.entries(tones)) {
    out.push({ name: `${tone} solid`, color: t.solid, min: text })
    t.bright.forEach((color, i) => out.push({ name: `${tone} bright ${i}`, color, min: text }))
    t.dim.forEach((color, i) => out.push({ name: `${tone} dim ${i}`, color, min: dim }))
  }
  return out
}

const suites = [
  { name: 'dark', backgrounds: DARK_BACKGROUNDS, checks: checks(TONES, TEXT, DIM) },
  { name: 'light', backgrounds: LIGHT_BACKGROUNDS, checks: checks(LIGHT_TONES, AAA, AAA) },
]

let failed = 0
const fixed = PALETTE.filter(([, color]) => !/^ansi256\(\d+\)$/.test(color ?? ''))
for (const [name] of fixed) console.log(`FAIL ${name} is a fixed color; defaults must be terminal palette indices`)
failed += fixed.length
console.log(`palette indices: ${PALETTE.map(([n, c]) => `${n}=${c}`).join(', ')} (contrast follows the terminal theme)`)
for (const suite of suites) {
  console.log(`\n${suite.name} palette`)
  for (const c of suite.checks) {
    const ratios = Object.entries(suite.backgrounds).map(([bg, hex]) => [bg, contrast(c.color, hex)] as const)
    const worst = ratios.reduce((a, b) => (b[1] < a[1] ? b : a))
    const ok = worst[1] >= c.min
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(16)} ${c.color}  worst ${worst[1].toFixed(2)}:1 on ${worst[0]} (needs ${c.min}:1)`)
  }
}
console.log(failed ? `\n${failed} color${failed === 1 ? '' : 's'} below the contrast gate` : '\nevery color passes')
process.exit(failed ? 1 : 0)
