<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api'
import { exchange, exchangeQuery } from '../exchange'

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
  buyOrder: {
    id: number
    ordId: string
    filledAt: string | null
    sz?: string | null
    accFillSz?: string | null
    px?: string | null
    avgPx?: string | null
    fillPx?: string | null
    fee?: string | null
    feeCcy?: string | null
  }
  orders: Array<{
    id: number
    ordId: string
    sz?: string | null
    accFillSz?: string | null
    allocatedSz: string | null
    px?: string | null
    avgPx: string | null
    fillPx: string | null
    fee: string | null
    feeCcy: string | null
    ordType?: string | null
    filledAt: string | null
  }>
}

const LEGACY_INST_KEY = 'trade_deals_instIds'

function instStorageKey(ex: string) {
  return `trade_deals_instIds_${ex}`
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

const deals = ref<Deal[]>([])
const instruments = ref<string[]>([])
const selectedInstIds = ref<string[]>(readStoredInstIds(exchange.value))
const instrumentsOpen = ref(false)
const error = ref('')
const loading = ref(false)
const dropdownRoot = ref<HTMLElement | null>(null)
const activeDealModal = ref<Deal | null>(null)

function openDealModal(deal: Deal) {
  activeDealModal.value = deal
}

function closeDealModal() {
  activeDealModal.value = null
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && activeDealModal.value) {
    closeDealModal()
  }
}

function sellSize(order: Deal['orders'][number]) {
  return order.allocatedSz || order.accFillSz || order.sz || '—'
}

function sellPrice(order: Deal['orders'][number]) {
  return order.avgPx || order.fillPx || order.px || '—'
}

function sellTotal(order: Deal['orders'][number], quoteCcy: string | null) {
  const sz = Number(order.allocatedSz || order.accFillSz || order.sz)
  const px = Number(order.avgPx || order.fillPx || order.px)
  if (!Number.isFinite(sz) || !Number.isFinite(px)) return '—'
  const val = (sz * px).toFixed(6).replace(/\.?0+$/, '')
  return `${val} ${quoteCcy || ''}`.trim()
}

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

function selectInstrument(instId: string) {
  selectedInstIds.value = [instId]
  void load()
}

function clearInstruments() {
  selectedInstIds.value = []
  void load()
}

function resetFilters() {
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
    const available = await api<string[]>(`/deals/instruments${exchangeQuery()}`)
    instruments.value = available
    selectedInstIds.value = selectedInstIds.value.filter((id) =>
      available.includes(id),
    )

    deals.value = await api<Deal[]>(
      `/deals${exchangeQuery(
        selectedInstIds.value.length
          ? { instIds: selectedInstIds.value.join(',') }
          : undefined,
      )}`,
    )
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
  void load()
})

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
  void load()
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
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
        <button class="secondary" type="button" :disabled="loading" @click="resetFilters">Reset</button>
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
            <td><strong class="coin-link" @click.stop="selectInstrument(d.instId)">{{ d.instId }}</strong></td>
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
            <td>
              <button
                type="button"
                class="sells-btn"
                title="Click to view sales details"
                @click.stop="openDealModal(d)"
              >
                {{ d.orders.length }}
              </button>
            </td>
          </tr>
          <tr v-if="!deals.length">
            <td colspan="7" class="empty">No closed deals yet</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal for Sells Details -->
    <div
      v-if="activeDealModal"
      class="modal-backdrop"
      @click.self="closeDealModal"
    >
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">
            <h3>Deal Details</h3>
            <span class="badge buy">{{ activeDealModal.instId }}</span>
            <span class="muted">· Closed {{ fmt(activeDealModal.closedAt) }}</span>
          </div>
          <button type="button" class="close-btn" title="Close" @click="closeDealModal">✕</button>
        </div>

        <div class="modal-summary-grid">
          <div class="modal-summary-item">
            <span class="muted">Buy Order</span>
            <strong>{{ activeDealModal.buySz }} @ {{ activeDealModal.buyAvgPx }}</strong>
            <span class="summary-sub">
              Fee: {{ activeDealModal.buyFee ? `${activeDealModal.buyFee} ${activeDealModal.buyFeeCcy || ''}`.trim() : '—' }}
            </span>
          </div>
          <div class="modal-summary-item">
            <span class="muted">Total Sells</span>
            <strong>{{ activeDealModal.sellSz }} @ {{ activeDealModal.sellAvgPx }}</strong>
            <span class="summary-sub">
              Fee: {{ activeDealModal.sellFee ? `${activeDealModal.sellFee} ${activeDealModal.sellFeeCcy || ''}`.trim() : '—' }}
            </span>
          </div>
          <div class="modal-summary-item">
            <span class="muted">Net PnL</span>
            <strong :class="Number(activeDealModal.pnl) >= 0 ? 'pos' : 'neg'" class="pnl-val">
              {{ Number(activeDealModal.pnl) >= 0 ? '+' : '' }}{{ activeDealModal.pnl }} {{ activeDealModal.quoteCcy || '' }}
            </strong>
            <span class="summary-sub">
              {{ activeDealModal.orders.length }} sell order{{ activeDealModal.orders.length === 1 ? '' : 's' }}
            </span>
          </div>
        </div>

        <div class="modal-section-title">
          <span>Sell Orders Breakdown</span>
          <span class="muted">({{ activeDealModal.orders.length }})</span>
        </div>

        <div class="modal-table-wrap">
          <table class="modal-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Filled At</th>
                <th>Size</th>
                <th>Price</th>
                <th>Total</th>
                <th>Fee</th>
                <th>Order ID</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(sell, idx) in activeDealModal.orders" :key="sell.id">
                <td class="muted">{{ idx + 1 }}</td>
                <td>{{ fmt(sell.filledAt) }}</td>
                <td><strong>{{ sellSize(sell) }}</strong></td>
                <td>{{ sellPrice(sell) }}</td>
                <td>{{ sellTotal(sell, activeDealModal.quoteCcy) }}</td>
                <td>{{ sell.fee ? `${sell.fee} ${sell.feeCcy || ''}`.trim() : '—' }}</td>
                <td><code class="ord-id" :title="sell.ordId">{{ sell.ordId }}</code></td>
              </tr>
              <tr v-if="!activeDealModal.orders.length">
                <td colspan="7" class="empty">No sell orders found</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="modal-actions">
          <button class="secondary" type="button" @click="closeDealModal">Close</button>
        </div>
      </div>
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
.coin-link {
  cursor: pointer;
  transition: color 0.15s ease;
}
.coin-link:hover {
  color: var(--ok);
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

.sells-btn {
  background: var(--panel-2);
  border: 1px solid var(--line);
  color: var(--text);
  border-radius: 8px;
  padding: 0.2rem 0.65rem;
  font-weight: 600;
  font-size: 0.88rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  transition: all 0.15s ease;
}
.sells-btn:hover {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1.25rem;
  animation: fadeIn 0.15s ease-out;
}

.modal-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
  width: 100%;
  max-width: 760px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
  padding: 1.5rem;
  animation: scaleIn 0.15s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.modal-title h3 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
}

.close-btn {
  background: transparent;
  border: 0;
  color: var(--muted);
  font-size: 1.2rem;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  border-radius: 6px;
  line-height: 1;
}
.close-btn:hover {
  color: var(--text);
  background: var(--panel-2);
}

.modal-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
  background: var(--bg-elevated);
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--line);
}

.modal-summary-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.92rem;
}

.summary-sub {
  font-size: 0.8rem;
  color: var(--muted);
}

.pnl-val {
  font-size: 1.05rem;
}

.modal-section-title {
  font-weight: 600;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.modal-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg-elevated);
}

.modal-table th,
.modal-table td {
  padding: 0.65rem 0.75rem;
  font-size: 0.88rem;
}

.ord-id {
  font-size: 0.8rem;
  font-family: monospace;
  color: var(--muted);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
</style>
