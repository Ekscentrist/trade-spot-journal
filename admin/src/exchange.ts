import { ref } from 'vue'

export const EXCHANGES = ['okx', 'bitget', 'gate'] as const
export type Exchange = (typeof EXCHANGES)[number]

const KEY = 'trade_exchange'

const LABELS: Record<Exchange, string> = {
  okx: 'OKX',
  bitget: 'Bitget',
  gate: 'Gate',
}

function isExchange(value: string): value is Exchange {
  return (EXCHANGES as readonly string[]).includes(value)
}

function read(): Exchange {
  try {
    const raw = localStorage.getItem(KEY)
    return raw && isExchange(raw) ? raw : 'okx'
  } catch {
    return 'okx'
  }
}

export const exchange = ref<Exchange>(read())

export function setExchange(value: Exchange | string) {
  exchange.value = isExchange(value) ? value : 'okx'
  localStorage.setItem(KEY, exchange.value)
}

export function exchangeLabel(value: Exchange = exchange.value) {
  return LABELS[value]
}

export function earnApiBase(value: Exchange = exchange.value) {
  return `/${value}/earn`
}

export function exchangeQuery(extra?: Record<string, string>) {
  const params = new URLSearchParams()
  params.set('exchange', exchange.value)
  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      if (val) params.set(key, val)
    }
  }
  return `?${params.toString()}`
}
