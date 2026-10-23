const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif', 'ico', 'jxl', 'qoi', 'tga'])
const VIDEO = new Set(['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'ogv'])

export const PNG_DIRECT_PIXELS = 4096
export const PNG_DIRECT_BYTES = 8_000_000
export const CACHE_KEEP = 64
export const EXIT_MISSING = 3
export const EXIT_FAILED = 4

export const POSTER = [
  'src=$1 base=$2 name=$3 kind=$4 keep=$5',
  'd="$base/filetree-preview-$(id -u)"',
  '[ -L "$d" ] && { echo "cache folder $d is a symbolic link" >&2; exit 1; }',
  'mkdir -m 700 "$d" 2>/dev/null',
  '[ -d "$d" ] && [ ! -L "$d" ] && [ -O "$d" ] || { echo "cache folder $d is not ours" >&2; exit 1; }',
  'chmod 700 "$d" || exit 1',
  'out="$d/$name"',
  'tmp=$(mktemp "$d/.part.XXXXXX") || exit 1',
  'trap \'rm -f "$tmp"\' EXIT',
  'tried=',
  'done_() { mv -f "$tmp" "$out" || exit 1; trap - EXIT; ls -t "$d" | grep "\\.png$" | tail -n +$((keep + 1)) | while read -r f; do rm -f "$d/$f"; done; printf "%s" "$out"; exit 0; }',
  'scale="scale=\'min(1600,iw)\':\'min(1600,ih)\':force_original_aspect_ratio=decrease"',
  'if [ "$kind" = video ]; then',
  '  if command -v ffmpegthumbnailer >/dev/null 2>&1; then tried=1; ffmpegthumbnailer -i "$src" -o "$tmp" -s 1024 -c png >/dev/null 2>&1 && [ -s "$tmp" ] && done_; fi',
  '  if command -v ffmpeg >/dev/null 2>&1; then',
  '    tried=1',
  '    ffmpeg -nostdin -v error -y -ss 1 -i "$src" -an -sn -frames:v 1 -vf "$scale" -f image2 -c:v png "$tmp" && [ -s "$tmp" ] && done_',
  '    ffmpeg -nostdin -v error -y -i "$src" -an -sn -frames:v 1 -vf "$scale" -f image2 -c:v png "$tmp" && [ -s "$tmp" ] && done_',
  '  fi',
  '  [ -n "$tried" ] && exit 4',
  '  echo "no ffmpegthumbnailer or ffmpeg on PATH for a poster frame" >&2; exit 3',
  'fi',
  'if command -v magick >/dev/null 2>&1; then tried=1; magick -limit memory 256MiB -limit map 512MiB -limit area 128MP -limit width 32KP -limit height 32KP -limit time 20 "$src[0]" -auto-orient -resize "1600x1600>" "png:$tmp" && [ -s "$tmp" ] && done_; fi',
  'if command -v ffmpeg >/dev/null 2>&1; then tried=1; ffmpeg -nostdin -v error -y -i "$src" -frames:v 1 -vf "$scale" -f image2 -c:v png "$tmp" && [ -s "$tmp" ] && done_; fi',
  '[ -n "$tried" ] && exit 4',
  'echo "no magick or ffmpeg on PATH to decode it" >&2; exit 3',
].join('\n')

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function pictureKind(path: string): 'png' | 'image' | 'video' | '' {
  const ext = extension(path)
  if (ext === 'png') return 'png'
  if (IMAGE.has(ext)) return 'image'
  return VIDEO.has(ext) ? 'video' : ''
}

export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null
  const at = (i: number) => ((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)
  const width = at(16) >>> 0
  const height = at(20) >>> 0
  return width && height ? { width, height } : null
}

export function fitCells(size: { width: number; height: number }, columns: number, rows: number): { columns: number; rows: number } {
  const cols = Math.max(1, Math.min(255, columns))
  const high = Math.max(1, Math.min(255, rows))
  const wide = Math.min(cols, Math.max(1, Math.round((high * 2 * size.width) / size.height)))
  return { columns: wide, rows: Math.max(1, Math.min(high, Math.round((wide * size.height) / (2 * size.width)))) }
}

function fnv(text: string, seed: number): string {
  let h = seed
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function cacheName(path: string, mtime: number, size: number): string {
  const text = `${path}\0${mtime}\0${size}`
  return `${fnv(text, 0x811c9dc5)}${fnv(text, 0x050c5d1f)}${fnv([...text].reverse().join(''), 0x2166136f)}${fnv(text, 0x9e3779b9)}.png`
}
