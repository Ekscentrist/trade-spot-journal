function hasFloatNoise(raw: string): boolean {
  const frac = raw.split('.')[1] || ''
  return /0{8,}[1-9]/.test(frac) || /9{8,}/.test(frac)
}

function trimDecimalZeros(raw: string): string {
  if (!raw.includes('.')) return raw === '-0' ? '0' : raw
  const trimmed = raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return trimmed === '-0' ? '0' : trimmed
}

/** Display exchange numbers without the binary-float tail from toFixed(16). */
export function prettyNum(value?: string | null): string {
  if (value == null || value === '') return '—'
  const raw = String(value).trim()
  if (!raw) return '—'
  if (/^-?\d+(\.\d{1,12})?$/.test(raw) && !hasFloatNoise(raw)) {
    return trimDecimalZeros(raw)
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return n.toFixed(8).replace(/\.?0+$/, '') || '0'
}
