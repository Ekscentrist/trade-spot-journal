<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { exchange, exchangeQuery } from '../exchange'
import { prettyNum } from '../num'
import { buySpent, fmtQuote, quoteOf, sellReceived } from '../stables'

type OrderRow = {
  id: number
  ordId: string
  instId: string
  side: string
  px: string | null
  avgPx: string | null
  fillPx: string | null
  sz: string | null
  accFillSz: string | null
  allocatedSz: string | null
  fee: string | null
  feeCcy: string | null
  filledAt: string | null
  archivedAt: string | null
}

type ArchiveResponse = {
  buys: OrderRow[]
  sells: OrderRow[]
}

const buys = ref<OrderRow[]>([])
const sells = ref<OrderRow[]>([])
const instId = ref('')
const loading = ref(false)
const error = ref('')
const message = ref('')

const instruments = computed(() =>
  [...new Set([...buys.value, ...sells.value].map((o) => o.instId))].sort(),
)
const shownBuys = computed(() =>
  instId.value ? buys.value.filter((o) => o.instId === instId.value) : buys.value,
)
const shownSells = computed(() =>
  instId.value ? sells.value.filter((o) => o.instId === instId.value) : sells.value,
)

function totals(rows: OrderRow[], calc: (o: OrderRow, q: string) => number | null) {
  const map = new Map<string, number>()
  for (const o of rows) {
    const q = quoteOf(o.instId)
    const v = calc(o, q)
    if (v == null) continue
    map.set(q, (map.get(q) || 0) + v)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([q, total]) => fmtQuote(total, q))
}

const spentTotals = computed(() => totals(shownBuys.value, buySpent))
const gotTotals = computed(() => totals(shownSells.value, sellReceived))

function price(o: OrderRow) {
  return prettyNum(o.avgPx || o.fillPx || o.px)
}

function size(o: OrderRow) {
  return prettyNum(o.accFillSz || o.sz)
}

function feeLabel(o: OrderRow) {
  if (!o.fee) return '—'
  return `${prettyNum(o.fee)} ${o.feeCcy || ''}`.trim()
}

function spentLabel(o: OrderRow) {
  const q = quoteOf(o.instId)
  return fmtQuote(buySpent(o, q), q)
}

function receivedLabel(o: OrderRow) {
  const q = quoteOf(o.instId)
  return fmtQuote(sellReceived(o, q), q)
}

function fmt(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString()
}

function apply(res: ArchiveResponse) {
  buys.value = res.buys
  sells.value = res.sells
  if (instId.value && !instruments.value.includes(instId.value)) instId.value = ''
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    apply(await api<ArchiveResponse>(`/orders/archive${exchangeQuery()}`))
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function restore(o: OrderRow) {
  loading.value = true
  error.value = ''
  message.value = ''
  try {
    const res = await api<{ archive: ArchiveResponse }>(`/orders/${o.id}/unarchive`, {
      method: 'POST',
    })
    apply(res.archive)
    message.value = `${o.instId} ${o.side} restored`
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function remove(o: OrderRow) {
  if (!confirm(`Delete ${o.side} ${o.instId} ${size(o)} @ ${price(o)}? This cannot be undone.`)) {
    return
  }
  loading.value = true
  error.value = ''
  message.value = ''
  try {
    const res = await api<{ archive: ArchiveResponse }>(`/orders/${o.id}`, {
      method: 'DELETE',
    })
    apply(res.archive)
    message.value = `${o.instId} ${o.side} deleted`
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

watch(exchange, () => {
  instId.value = ''
  void load()
})

onMounted(() => void load())
</script>

<template>
  <div class="page">
    <div class="head">
      <h1>Archive</h1>
      <div class="actions">
        <select v-model="instId">
          <option value="">All coins</option>
          <option v-for="id in instruments" :key="id" :value="id">{{ id }}</option>
        </select>
        <button class="secondary" type="button" :disabled="loading" @click="load">Refresh</button>
      </div>
    </div>

    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="message" class="ok-msg">{{ message }}</div>

    <div class="board">
      <section class="column">
        <h2>
          Archived buys ({{ shownBuys.length }})
          <span v-if="spentTotals.length" class="total">
            spent <span class="neg">{{ spentTotals.join(' · ') }}</span>
          </span>
        </h2>
        <div v-if="!shownBuys.length" class="empty">No archived buys</div>
        <article v-for="o in shownBuys" :key="o.id" class="card">
          <div class="card-top">
            <span class="badge buy">buy</span>
            <strong class="coin-link" @click="instId = o.instId">{{ o.instId }}</strong>
            <button class="linkish" type="button" :disabled="loading" @click="restore(o)">Restore</button>
            <button class="linkish dangerish" type="button" :disabled="loading" @click="remove(o)">Delete</button>
          </div>
          <div class="meta">
            <span>Size {{ size(o) }}</span>
            <span>Px {{ price(o) }}</span>
            <span>Spent <span class="neg">{{ spentLabel(o) }}</span></span>
            <span>Fee {{ feeLabel(o) }}</span>
          </div>
          <div class="meta dates">
            <span class="muted">filled {{ fmt(o.filledAt) }}</span>
            <span class="muted">archived {{ fmt(o.archivedAt) }}</span>
          </div>
        </article>
      </section>

      <section class="column">
        <h2>
          Archived sells ({{ shownSells.length }})
          <span v-if="gotTotals.length" class="total">
            got <span class="pos">{{ gotTotals.join(' · ') }}</span>
          </span>
        </h2>
        <div v-if="!shownSells.length" class="empty">No archived sells</div>
        <article v-for="o in shownSells" :key="o.id" class="card">
          <div class="card-top">
            <span class="badge sell">sell</span>
            <strong class="coin-link" @click="instId = o.instId">{{ o.instId }}</strong>
            <button class="linkish" type="button" :disabled="loading" @click="restore(o)">Restore</button>
            <button class="linkish dangerish" type="button" :disabled="loading" @click="remove(o)">Delete</button>
          </div>
          <div class="meta">
            <span>Size {{ size(o) }}</span>
            <span>Px {{ price(o) }}</span>
            <span>Got <span class="pos">{{ receivedLabel(o) }}</span></span>
            <span>Fee {{ feeLabel(o) }}</span>
          </div>
          <div class="meta dates">
            <span class="muted">filled {{ fmt(o.filledAt) }}</span>
            <span class="muted">archived {{ fmt(o.archivedAt) }}</span>
          </div>
        </article>
      </section>
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
h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  color: var(--muted);
  font-weight: 600;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
}
.total { font-size: 0.88rem; font-weight: 500; }
.actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.board {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
@media (max-width: 900px) {
  .board { grid-template-columns: 1fr; }
}
.column { min-width: 0; }
.card {
  border: 1px solid var(--line);
  background: var(--bg-elevated);
  border-radius: 12px;
  padding: 0.85rem;
  margin-bottom: 0.75rem;
}
.card-top {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.45rem;
  flex-wrap: wrap;
}
.card-top .linkish:first-of-type { margin-left: auto; }
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.9rem;
  color: var(--text);
}
.meta.dates { margin-top: 0.3rem; }
.coin-link { cursor: pointer; transition: color 0.15s ease; }
.coin-link:hover { color: var(--ok); }
.linkish {
  background: transparent;
  color: #93c5fd;
  padding: 0;
  border: 0;
  font-size: 0.82rem;
}
.linkish:hover { background: transparent; color: #bfdbfe; }
.dangerish { color: #fda4af !important; }
.muted { color: var(--muted); font-size: 0.85rem; }
.ok-msg { color: var(--ok); font-size: 0.9rem; }
.pos { color: var(--buy); }
.neg { color: var(--sell); }
.empty { color: var(--muted); padding: 1rem 0.25rem; }
</style>
