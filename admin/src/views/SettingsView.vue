<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api } from '../api'

type Settings = {
  okxApiKey: string | null
  okxSecret: string | null
  okxPassphrase: string | null
  telegramBotToken: string | null
  telegramChatId: string | null
  hasOkx: boolean
  hasTelegram: boolean
  updatedAt: string
}

type Status = {
  okx: {
    connected: boolean
    loggedIn: boolean
    lastError: string | null
    reconnecting: boolean
  }
}

const form = reactive({
  okxApiKey: '',
  okxSecret: '',
  okxPassphrase: '',
  telegramBotToken: '',
  telegramChatId: '',
})

const settings = ref<Settings | null>(null)
const status = ref<Status | null>(null)
const error = ref('')
const message = ref('')
const loading = ref(false)

async function load() {
  error.value = ''
  try {
    const [s, st] = await Promise.all([
      api<Settings>('/settings'),
      api<Status>('/status'),
    ])
    settings.value = s
    status.value = st
    form.telegramChatId = s.telegramChatId || ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function save() {
  loading.value = true
  error.value = ''
  message.value = ''
  try {
    const body: Record<string, string> = {}
    for (const [k, v] of Object.entries(form)) {
      if (v.trim()) body[k] = v.trim()
    }
    settings.value = await api<Settings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    form.okxApiKey = ''
    form.okxSecret = ''
    form.okxPassphrase = ''
    form.telegramBotToken = ''
    status.value = await api<Status>('/status')
    message.value = 'Saved. OKX reconnect triggered.'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function reconnect() {
  loading.value = true
  error.value = ''
  message.value = ''
  try {
    const okx = await api<Status['okx']>('/settings/reconnect', { method: 'PUT' })
    status.value = { okx }
    message.value = 'Reconnect requested.'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <h1>Settings</h1>
        <p>OKX read-only key + Telegram bot</p>
      </div>
      <button class="secondary" type="button" @click="reconnect" :disabled="loading">
        Reconnect OKX
      </button>
    </div>

    <div v-if="status" class="status">
      <span
        class="badge"
        :class="status.okx.connected && status.okx.loggedIn ? 'ok' : 'err'"
      >
        OKX {{ status.okx.connected && status.okx.loggedIn ? 'online' : 'offline' }}
      </span>
      <span v-if="settings" class="badge" :class="settings.hasOkx ? 'ok' : 'warn'">
        keys {{ settings.hasOkx ? 'set' : 'missing' }}
      </span>
      <span v-if="settings" class="badge" :class="settings.hasTelegram ? 'ok' : 'warn'">
        telegram {{ settings.hasTelegram ? 'set' : 'missing' }}
      </span>
      <span v-if="status.okx.lastError" class="error">{{ status.okx.lastError }}</span>
    </div>

    <form class="grid" @submit.prevent="save">
      <h2>OKX</h2>
      <label>
        API Key
        <input v-model="form.okxApiKey" :placeholder="settings?.okxApiKey || 'API key'" />
      </label>
      <label>
        Secret
        <input v-model="form.okxSecret" type="password" :placeholder="settings?.okxSecret || 'Secret'" />
      </label>
      <label>
        Passphrase
        <input v-model="form.okxPassphrase" type="password" :placeholder="settings?.okxPassphrase || 'Passphrase'" />
      </label>

      <h2>Telegram</h2>
      <label>
        Bot token
        <input
          v-model="form.telegramBotToken"
          type="password"
          :placeholder="settings?.telegramBotToken || '123:ABC…'"
        />
      </label>
      <label>
        Chat ID
        <input v-model="form.telegramChatId" placeholder="e.g. 123456789" />
      </label>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="message" class="ok">{{ message }}</p>

      <button type="submit" :disabled="loading">
        {{ loading ? 'Saving…' : 'Save' }}
      </button>
    </form>
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
h2 { margin: 0.5rem 0 0; font-size: 1rem; }
p { margin: 0.2rem 0 0; color: var(--muted); }
.status { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; }
.grid {
  display: grid;
  gap: 0.85rem;
  max-width: 520px;
}
.ok { color: var(--ok); font-size: 0.9rem; }
</style>
