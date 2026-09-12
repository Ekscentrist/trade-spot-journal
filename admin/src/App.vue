<script setup lang="ts">
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'
import { clearToken, getToken } from './api'
import { exchange, setExchange, type Exchange } from './exchange'

const route = useRoute()
const router = useRouter()
const authed = computed(() => Boolean(getToken()) && route.name !== 'login')

const selectedExchange = computed({
  get: () => exchange.value,
  set: (value: string) => setExchange(value === 'bitget' ? 'bitget' : 'okx'),
})

function logout() {
  clearToken()
  router.push({ name: 'login' })
}

function onExchangeChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as Exchange
  setExchange(value)
}
</script>

<template>
  <div class="shell">
    <header v-if="authed" class="top">
      <div class="brand">Trade</div>
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
        <button class="secondary" type="button" @click="logout">Logout</button>
      </div>
    </header>
    <main>
      <RouterView />
    </main>
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
</style>
