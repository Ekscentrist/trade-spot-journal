import { ref } from 'vue'

export type Exchange = 'okx' | 'bitget'

const KEY = 'trade_exchange'

function read(): Exchange {
  try {
    return localStorage.getItem(KEY) === 'bitget' ? 'bitget' : 'okx'
  } catch {
    return 'okx'
  }
}

export const exchange = ref<Exchange>(read())

export function setExchange(value: Exchange) {
  exchange.value = value === 'bitget' ? 'bitget' : 'okx'
  localStorage.setItem(KEY, exchange.value)
}

export function exchangeLabel(value: Exchange = exchange.value) {
  return value === 'bitget' ? 'Bitget' : 'OKX'
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
