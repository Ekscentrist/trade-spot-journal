<script setup lang="ts">
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'
import { clearToken, getToken } from './api'

const route = useRoute()
const router = useRouter()
const authed = computed(() => Boolean(getToken()) && route.name !== 'login')

function logout() {
  clearToken()
  router.push({ name: 'login' })
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
      <button class="secondary" type="button" @click="logout">Logout</button>
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
main {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 1.25rem;
  box-shadow: var(--shadow);
}
.brand {
  color: var(--text);
}
</style>
