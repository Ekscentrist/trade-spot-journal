<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api'
import { exchange, exchangeQuery } from '../exchange'

type OrderRow = {
  id: number
  ordId: string
  instId: string
  side: string
  ordType: string | null
  state: string
  px: string | null
  avgPx: string | null
  fillPx: string | null
  sz: string | null
  accFillSz: string | null
  allocatedSz: string | null
  fee: string | null
  feeCcy: string | null
  filledAt: string | null
  matchedBuyId: number | null
  dealId: number | null
  archivedAt: string | null
  stakedAt: string | null
}

type StakedBuy = OrderRow & {
  matchedSells: OrderRow[]
  soldSz: string
  remainingSz: string
  coverage: number
  lastPx: string | null
  partialPnl: string
  partialPnlIsMtm: boolean
  quoteCcy: string
}

type MtmRow = {
  id: number
  lastPx: string | null
  partialPnl: string
  partialPnlIsMtm: boolean
  quoteCcy: string
  remainingSz: string
  soldSz: string
  coverage: number
}

type MtmResponse = {
  buys: MtmRow[]
}

const MTM_POLL_MS = 5_000
const LEGACY_INST_KEY = 'trade_staking_instIds'

function instStorageKey(ex: string) {
  return `trade_staking_instIds_${ex}`
}

function readStoredInstIds(ex: string): string[] {
  try {
    const raw =
      localStorage.getItem(instStorageKey(ex)) ||
      (ex === 'okx' ? localStorage.getItem(LEGACY_INST_KEY) : null)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

const buys = ref<StakedBuy[]>([])
const instruments = ref<string[]>([])
const selectedInstIds = ref<string[]>(readStoredInstIds(exchange.value))
const instrumentsOpen = ref(false)
const error = ref('')
const message = ref('')
const loading = ref(false)
const dropdownRoot = ref<HTMLElement | null>(null)
let mtmTimer: ReturnType<typeof setInterval> | null = null
let mtmInFlight = false

const selectedLabel = computed(() => {
  if (!selectedInstIds.value.length) return 'All coins'
  if (selectedInstIds.value.length === 1) return selectedInstIds.value[0]
  return `${selectedInstIds.value.length} coins`
})

const unrealizedTotals = computed(() => {
  const map = new Map<string, number>()
  for (const buy of buys.value) {
    if (!buy.partialPnlIsMtm) continue
    const pnl = Number(buy.partialPnl)
    if (!Number.isFinite(pnl)) continue
    const quote = buy.quoteCcy || 'USDT'
    map.set(quote, (map.get(quote) || 0) + pnl)
  }
  return [...map.entries()]
    .map(([quote, total]) => ({ quote, total }))
    .sort((a, b) => a.quote.localeCompare(b.quote))
})

function formatTotal(value: number) {
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6
  return value.toFixed(digits).replace(/\.?0+$/, '') || '0'
}

function price(o: OrderRow) {
  return o.avgPx || o.fillPx || o.px || '—'
}

function size(o: OrderRow) {
  return o.allocatedSz || o.accFillSz || o.sz || '—'
}

function fmt(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString()
}

function pct(coverage: number) {
  return `${Math.min(coverage * 100, 100).toFixed(1)}%`
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

function openQuery() {
  return exchangeQuery(
    selectedInstIds.value.length
      ? { instIds: selectedInstIds.value.join(',') }
      : undefined,
  )
}

function mergeMtm(rows: MtmRow[]) {
  if (!rows.length) return
  const byId = new Map(rows.map((row) => [row.id, row]))
  buys.value = buys.value.map((buy) => {
    const patch = byId.get(buy.id)
    if (!patch) return buy
    return {
      ...buy,
      lastPx: patch.lastPx,
      partialPnl: patch.partialPnl,
      partialPnlIsMtm: patch.partialPnlIsMtm,
      quoteCcy: patch.quoteCcy,
      remainingSz: patch.remainingSz,
      soldSz: patch.soldSz,
      coverage: patch.coverage,
    }
  })
}

async function pollMtm() {
  if (mtmInFlight || document.visibilityState === 'hidden') return
  if (!buys.value.length) return
  mtmInFlight = true
  try {
    const res = await api<MtmResponse>(`/orders/staking/mtm${openQuery()}`)
    mergeMtm(res.buys)
  } catch {
    // Silent poll
  } finally {
    mtmInFlight = false
  }
}

function stopMtmPoll() {
  if (mtmTimer != null) {
    clearInterval(mtmTimer)
    mtmTimer = null
  }
}

function startMtmPoll() {
  stopMtmPoll()
  if (document.visibilityState === 'hidden') return
  mtmTimer = setInterval(() => {
    void pollMtm()
  }, MTM_POLL_MS)
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    stopMtmPoll()
    return
  }
  void pollMtm()
  startMtmPoll()
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const available = await api<string[]>(`/orders/instruments${exchangeQuery()}`)
    instruments.value = available
    selectedInstIds.value = selectedInstIds.value.filter((id) =>
      available.includes(id),
    )
    buys.value = await api<StakedBuy[]>(`/orders/staking${openQuery()}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function unstake(orderId: number) {
  loading.value = true
  error.value = ''
  message.value = ''
  try {
    const res = await api<{ staking: StakedBuy[] }>(`/orders/${orderId}/unstake`, {
      method: 'POST',
    })
    buys.value = selectedInstIds.value.length
      ? res.staking.filter((buy) => selectedInstIds.value.includes(buy.instId))
      : res.staking
    message.value = 'Buy returned to Orders'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

watch(
  selectedInstIds,
  (value) => {
    localStorage.setItem(instStorageKey(exchange.value), JSON.stringify(value))
  },
  { deep: true },
)

watch(exchange, (ex) => {
  selectedInstIds.value = readStoredInstIds(ex)
  void load().then(() => startMtmPoll())
})

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('visibilitychange', onVisibilityChange)
  void load().then(() => startMtmPoll())
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopMtmPoll()
})
</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <h1>Staking</h1>
        <p>Buys parked while coins are staked on the exchange. Live uPnL on remaining size.</p>
      </div>
      <div class="actions">
        <div class="unrealized">
          <span class="unrealized-label">Unrealized</span>
          <template v-if="unrealizedTotals.length">
            <strong
              v-for="row in unrealizedTotals"
              :key="row.quote"
              :class="row.total >= 0 ? 'pos' : 'neg'"
            >
              {{ row.total >= 0 ? '+' : '' }}{{ formatTotal(row.total) }} {{ row.quote }}
            </strong>
          </template>
          <span v-else class="muted">—</span>
        </div>

        <div ref="dropdownRoot" class="dropdown">
          <button class="secondary dropdown-trigger" type="button" @click="instrumentsOpen = !instrumentsOpen">
            {{ selectedLabel }}
            <span class="caret">▾</span>
          </button>
          <div v-if="instrumentsOpen" class="dropdown-menu">
            <div class="dropdown-head">
              <span>Coins with fills</span>
              <button type="button" class="linkish" @click="clearInstruments">Clear</button>
            </div>
            <label v-for="inst in instruments" :key="inst" class="check-row">
              <input type="checkbox" :checked="isSelected(inst)" @change="toggleInstrument(inst)" />
              <span>{{ inst }}</span>
            </label>
            <div v-if="!instruments.length" class="empty-mini">No coins yet</div>
          </div>
        </div>

        <button class="secondary" type="button" :disabled="loading" @click="load">Refresh</button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok-msg">{{ message }}</p>

    <div v-if="!buys.length" class="empty">No staked buys</div>
    <article v-for="buy in buys" :key="buy.id" class="card">
      <div class="card-top">
        <span class="badge warn">staked</span>
        <strong>{{ buy.instId }}</strong>
        <span class="muted">{{ fmt(buy.stakedAt) }}</span>
        <button class="linkish" type="button" @click="unstake(buy.id)">Unstake</button>
      </div>
      <div class="meta">
        <span>Size {{ size(buy) }}</span>
        <span>Px {{ price(buy) }}</span>
        <span v-if="buy.lastPx">Now {{ buy.lastPx }}</span>
        <span>Fee {{ buy.fee ? `${buy.fee} ${buy.feeCcy || ''}`.trim() : '—' }}</span>
      </div>
      <div class="progress">
        <div class="bar"><i :style="{ width: pct(buy.coverage) }" /></div>
        <div class="progress-text">
          Sold {{ buy.soldSz }} / {{ size(buy) }} ({{ pct(buy.coverage) }})
          · left {{ buy.remainingSz }}
          · {{ buy.partialPnlIsMtm ? 'MTM PnL' : 'partial PnL' }}
          <strong :class="Number(buy.partialPnl) >= 0 ? 'pos' : 'neg'">
            {{ buy.partialPnl }} {{ buy.quoteCcy }}
          </strong>
        </div>
      </div>
      <div v-if="buy.matchedSells.length" class="nested">
        <div class="nested-title">Linked sells</div>
        <div v-for="sell in buy.matchedSells" :key="sell.id" class="nested-row">
          <span class="badge sell">sell</span>
          <span>{{ size(sell) }} @ {{ price(sell) }}</span>
          <span class="muted">{{ fmt(sell.filledAt) }}</span>
        </div>
      </div>
    </article>
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
.unrealized {
  display: inline-flex;
  align-items: baseline;
  gap: 0.55rem;
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-elevated);
  min-width: 160px;
}
.unrealized-label {
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.unrealized strong { font-size: 1rem; }
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
.linkish:hover {
  background: transparent;
  color: #bfdbfe;
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
.check-row:hover { background: rgba(255, 255, 255, 0.04); }
.check-row input { width: auto; accent-color: var(--accent); }
.empty-mini { padding: 0.75rem; color: var(--muted); font-size: 0.88rem; }
.muted { color: var(--muted); font-size: 0.9rem; }
.ok-msg { color: var(--ok); font-size: 0.9rem; }
.card {
  border: 1px solid var(--line);
  background: var(--bg-elevated);
  border-radius: 12px;
  padding: 0.85rem;
}
.card-top {
  display: flex;
  gap: 0.55rem;
  align-items: center;
  margin-bottom: 0.45rem;
}
.card-top .linkish { margin-left: auto; }
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.9rem;
  color: var(--text);
}
.progress { margin-top: 0.7rem; }
.bar {
  height: 6px;
  border-radius: 999px;
  background: #243041;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #3b82f6);
}
.progress-text {
  margin-top: 0.4rem;
  font-size: 0.84rem;
  color: var(--muted);
}
.pos { color: var(--buy); }
.neg { color: var(--sell); }
.nested {
  margin-top: 0.75rem;
  padding-top: 0.65rem;
  border-top: 1px dashed var(--line);
}
.nested-title {
  font-size: 0.8rem;
  color: var(--muted);
  margin-bottom: 0.4rem;
}
.nested-row {
  display: flex;
  gap: 0.55rem;
  align-items: center;
  flex-wrap: wrap;
  padding: 0.35rem 0;
  font-size: 0.88rem;
}
.empty {
  color: var(--muted);
  padding: 1rem 0.25rem;
}
</style>
