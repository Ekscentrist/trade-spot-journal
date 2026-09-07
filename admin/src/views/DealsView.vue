<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api'

type Deal = {
  id: number
  instId: string
  buyOrderId: number
  buySz: string
  buyAvgPx: string
  buyFee: string | null
  buyFeeCcy: string | null
  sellSz: string
  sellAvgPx: string
  sellFee: string | null
  sellFeeCcy: string | null
  pnl: string
  quoteCcy: string | null
  closedAt: string
  createdAt: string
  buyOrder: { id: number; ordId: string; filledAt: string | null }
  orders: Array<{
    id: number
    ordId: string
    allocatedSz: string | null
    avgPx: string | null
    fillPx: string | null
    fee: string | null
    feeCcy: string | null
    filledAt: string | null
  }>
}

const INST_KEY = 'trade_deals_instIds'

function readStoredInstIds(): string[] {
  try {
    const raw = localStorage.getItem(INST_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

const deals = ref<Deal[]>([])
const instruments = ref<string[]>([])
const selectedInstIds = ref<string[]>(readStoredInstIds())
const instrumentsOpen = ref(false)
const error = ref('')
const loading = ref(false)
const dropdownRoot = ref<HTMLElement | null>(null)

const selectedLabel = computed(() => {
  if (!selectedInstIds.value.length) return 'All coins'
  if (selectedInstIds.value.length === 1) return selectedInstIds.value[0]
  return `${selectedInstIds.value.length} coins`
})

const totalsByQuote = computed(() => {
  const map = new Map<string, number>()
  for (const deal of deals.value) {
    const quote = deal.quoteCcy || 'USDT'
    const pnl = Number(deal.pnl)
    if (!Number.isFinite(pnl)) continue
    map.set(quote, (map.get(quote) || 0) + pnl)
  }
  return [...map.entries()]
    .map(([quote, total]) => ({ quote, total }))
    .sort((a, b) => a.quote.localeCompare(b.quote))
})

function formatTotal(value: number) {
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6
  const fixed = value.toFixed(digits).replace(/\.?0+$/, '')
  return fixed || '0'
}

function fmt(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString()
}

function isSelected(instId: string) {
  return selectedInstIds.value.includes(instId)
}

function toggleInstrument(instId: string) {
  if (isSelected(instId)) {
    selectedInstIds.value = selectedInstIds.value.filter((id) => id !== instId)
  } else {
    selectedInstIds.value = [...selectedInstIds.value, instId]
  }
  void load()
}

function clearInstruments() {
  selectedInstIds.value = []
  void load()
}

function onDocumentClick(event: MouseEvent) {
  if (!dropdownRoot.value) return
  if (!dropdownRoot.value.contains(event.target as Node)) {
    instrumentsOpen.value = false
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const available = await api<string[]>('/deals/instruments')
    instruments.value = available
    selectedInstIds.value = selectedInstIds.value.filter((id) =>
      available.includes(id),
    )

    const params = new URLSearchParams()
    if (selectedInstIds.value.length) {
      params.set('instIds', selectedInstIds.value.join(','))
    }
    const qs = params.toString() ? `?${params.toString()}` : ''
    deals.value = await api<Deal[]>(`/deals${qs}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

watch(
  selectedInstIds,
  (value) => {
    localStorage.setItem(INST_KEY, JSON.stringify(value))
  },
  { deep: true },
)

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  void load()
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})
</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <h1>Deals</h1>
        <p>Closed round-trips (buy sold ≥99%) with PnL after fees</p>
      </div>
      <div class="actions">
        <div ref="dropdownRoot" class="dropdown">
          <button class="secondary dropdown-trigger" type="button" @click="instrumentsOpen = !instrumentsOpen">
            {{ selectedLabel }}
            <span class="caret">▾</span>
          </button>
          <div v-if="instrumentsOpen" class="dropdown-menu">
            <div class="dropdown-head">
              <span>Coins</span>
              <button type="button" class="linkish" @click="clearInstruments">Clear</button>
            </div>
            <label v-for="inst in instruments" :key="inst" class="check-row">
              <input type="checkbox" :checked="isSelected(inst)" @change="toggleInstrument(inst)" />
              <span>{{ inst }}</span>
            </label>
            <div v-if="!instruments.length" class="empty-mini">No deals yet</div>
          </div>
        </div>
        <button class="secondary" type="button" :disabled="loading" @click="load">Refresh</button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="summary">
      <div class="summary-label">
        Total PnL
        <span class="muted">· {{ selectedLabel }} · {{ deals.length }} deals</span>
      </div>
      <div v-if="totalsByQuote.length" class="summary-values">
        <strong
          v-for="row in totalsByQuote"
          :key="row.quote"
          :class="row.total >= 0 ? 'pos' : 'neg'"
        >
          {{ row.total >= 0 ? '+' : '' }}{{ formatTotal(row.total) }} {{ row.quote }}
        </strong>
      </div>
      <div v-else class="muted">No deals in current filter</div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Closed</th>
            <th>Pair</th>
            <th>Buy</th>
            <th>Sell</th>
            <th>Fees</th>
            <th>PnL</th>
            <th>Sells</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in deals" :key="d.id">
            <td>{{ fmt(d.closedAt) }}</td>
            <td>{{ d.instId }}</td>
            <td>{{ d.buySz }} @ {{ d.buyAvgPx }}</td>
            <td>{{ d.sellSz }} @ {{ d.sellAvgPx }}</td>
            <td>
              buy {{ d.buyFee ? `${d.buyFee} ${d.buyFeeCcy || ''}`.trim() : '—' }}
              <br />
              sell {{ d.sellFee ? `${d.sellFee} ${d.sellFeeCcy || ''}`.trim() : '—' }}
            </td>
            <td>
              <strong :class="Number(d.pnl) >= 0 ? 'pos' : 'neg'">
                {{ d.pnl }} {{ d.quoteCcy || '' }}
              </strong>
            </td>
            <td>{{ d.orders.length }}</td>
          </tr>
          <tr v-if="!deals.length">
            <td colspan="7" class="empty">No closed deals yet</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.page { display: grid; gap: 1rem; }
.head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: end;
  flex-wrap: wrap;
}
h1 { margin: 0; font-size: 1.35rem; }
p { margin: 0.2rem 0 0; color: var(--muted); }
.actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.dropdown { position: relative; }
.dropdown-trigger {
  min-width: 150px;
  display: inline-flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
}
.caret { color: var(--muted); font-size: 0.8rem; }
.dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  min-width: 220px;
  max-height: 280px;
  overflow: auto;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 0.45rem;
}
.dropdown-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0.45rem 0.55rem;
  color: var(--muted);
  font-size: 0.82rem;
}
.linkish {
  background: transparent;
  color: #93c5fd;
  padding: 0;
  border: 0;
  font-size: 0.82rem;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem;
  border-radius: 8px;
  color: var(--text);
  cursor: pointer;
}
.check-row input { width: auto; accent-color: var(--accent); }
.empty-mini { padding: 0.75rem; color: var(--muted); font-size: 0.88rem; }
.summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.85rem 1rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-elevated);
}
.summary-label {
  font-weight: 600;
  display: flex;
  gap: 0.45rem;
  align-items: baseline;
  flex-wrap: wrap;
}
.summary-values {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  font-size: 1.15rem;
}
.table-wrap { overflow-x: auto; }
.empty { color: var(--muted); text-align: center; padding: 1.5rem; }
.pos { color: var(--buy); }
.neg { color: var(--sell); }
.muted { color: var(--muted); font-size: 0.9rem; font-weight: 400; }
</style>
