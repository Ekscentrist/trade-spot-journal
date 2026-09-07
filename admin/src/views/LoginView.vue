<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, setToken } from '../api'

const login = ref('admin')
const password = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const route = useRoute()

async function submit() {
  error.value = ''
  loading.value = true
  try {
    const res = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: login.value, password: password.value }),
    })
    setToken(res.accessToken)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(redirect)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <h1>Trade Admin</h1>
    <p>OKX Spot fills → Telegram</p>
    <form @submit.prevent="submit">
      <label>
        Login
        <input v-model="login" autocomplete="username" required />
      </label>
      <label>
        Password
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="loading">
        {{ loading ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login {
  max-width: 360px;
  margin: 2rem auto;
  display: grid;
  gap: 0.85rem;
}
h1 { margin: 0; font-size: 1.6rem; }
p { margin: 0; color: var(--muted); }
form { display: grid; gap: 0.85rem; margin-top: 0.5rem; }
</style>
