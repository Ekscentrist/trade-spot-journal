<script setup lang="ts">
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { computed, onUnmounted, ref, watch } from 'vue'
import { api, clearToken, getToken } from './api'
import { exchange, exchangeLabel, setExchange, type Exchange } from './exchange'

type AssetHolding = { ccy: string; trading: string; earn: string }

const route = useRoute()
const router = useRouter()
const authed = computed(() => Boolean(getToken()) && route.name !== 'login')

const selectedExchange = computed({
  get: () => exchange.value,
  set: (value: string) => setExchange(value === 'bitget' ? 'bitget' : 'okx'),
})

const balancesOpen = ref(false)
const balancesLoading = ref(false)
const balancesError = ref('')
const assets = ref<AssetHolding[]>([])

function logout() {
  clearToken()
  router.push({ name: 'login' })
}

function onExchangeChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as Exchange
  setExchange(value)
}

function fmtAmt(value?: string | null) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n >= 100) return n.toFixed(2).replace(/\.?0+$/, '')
  return n.toFixed(4).replace(/\.?0+$/, '')
}

async function loadHoldings() {
  balancesLoading.value = true
  balancesError.value = ''
  const base = exchange.value === 'bitget' ? '/bitget/earn' : '/okx/earn'
  try {
    const data = await api<{ assets: AssetHolding[] }>(`${base}/holdings`)
    assets.value = data.assets || []
  } catch (error) {
    assets.value = []
    balancesError.value =
      error instanceof Error ? error.message : 'Failed to load balances'
  } finally {
    balancesLoading.value = false
  }
}

function openBalances() {
  balancesOpen.value = true
  void loadHoldings()
}

function closeBalances() {
  balancesOpen.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && balancesOpen.value) closeBalances()
}

watch(balancesOpen, (open) => {
  if (open) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})

watch(exchange, () => {
  if (balancesOpen.value) void loadHoldings()
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="shell">
    <header v-if="authed" class="top">
      <nav>
        <RouterLink to="/">Orders</RouterLink>
        <RouterLink to="/staking">Staking</RouterLink>
        <RouterLink to="/deals">Deals</RouterLink>
        <RouterLink to="/settings">Settings</RouterLink>
      </nav>
      <div class="header-actions">
        <select
          class="exchange-select"
          :value="selectedExchange"
          @change="onExchangeChange"
        >
          <option value="okx">OKX</option>
          <option value="bitget">Bitget</option>
        </select>
        <button class="secondary" type="button" @click="openBalances">Balances</button>
        <button class="secondary" type="button" @click="logout">Logout</button>
      </div>
    </header>
    <main>
      <RouterView />
    </main>

    <div
      v-if="balancesOpen"
      class="modal-backdrop"
      @click.self="closeBalances"
    >
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">
            <h3>Balances</h3>
            <span class="muted">{{ exchangeLabel() }}</span>
          </div>
          <button type="button" class="close-btn" title="Close" @click="closeBalances">✕</button>
        </div>

        <p v-if="balancesLoading" class="muted">Loading…</p>
        <p v-else-if="balancesError" class="error">{{ balancesError }}</p>
        <p v-else-if="!assets.length" class="muted">No balances</p>
        <div v-else class="modal-table-wrap">
          <table class="modal-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Trading</th>
                <th>Earn</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in assets" :key="row.ccy">
                <td><strong>{{ row.ccy }}</strong></td>
                <td>{{ fmtAmt(row.trading) }}</td>
                <td>{{ fmtAmt(row.earn) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.25rem;
}
.top {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.brand {
  font-weight: 700;
  letter-spacing: 0.02em;
  font-size: 1.15rem;
  color: var(--text);
}
nav {
  display: flex;
  gap: 0.85rem;
  flex: 1;
}
nav a {
  color: var(--muted);
  font-weight: 600;
}
nav a.router-link-active {
  color: var(--text);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}
.exchange-select {
  width: auto;
  min-width: 7.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--panel-2);
  border: 1px solid var(--line);
}
main {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 1.25rem;
  box-shadow: var(--shadow);
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
}
.modal-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
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
  border-radius: 6px;
  line-height: 1;
}
.close-btn:hover {
  color: var(--text);
  background: var(--panel-2);
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
</style>
