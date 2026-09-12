<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api } from '../api'
import { type Exchange, exchangeLabel } from '../exchange'

type Settings = {
  okxApiKey: string | null
  okxSecret: string | null
  okxPassphrase: string | null
  bitgetApiKey: string | null
  bitgetSecret: string | null
  bitgetPassphrase: string | null
  telegramBotToken: string | null
  telegramChatId: string | null
  hasOkx: boolean
  hasBitget: boolean
  hasTelegram: boolean
  updatedAt: string
}

type ConnStatus = {
  connected: boolean
  loggedIn: boolean
  lastError: string | null
  lastEventAt?: string | null
  reconnecting: boolean
}

type Status = {
  okx: ConnStatus
  bitget: ConnStatus
}

const form = reactive({
  okxApiKey: '',
  okxSecret: '',
  okxPassphrase: '',
  bitgetApiKey: '',
  bitgetSecret: '',
  bitgetPassphrase: '',
  telegramBotToken: '',
  telegramChatId: '',
})

const settings = ref<Settings | null>(null)
const status = ref<Status | null>(null)
const error = ref('')
const message = ref('')
const loading = ref(false)

function online(conn?: ConnStatus | null) {
  return Boolean(conn?.connected && conn.loggedIn)
}

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
    form.bitgetApiKey = ''
    form.bitgetSecret = ''
    form.bitgetPassphrase = ''
    form.telegramBotToken = ''
    status.value = await api<Status>('/status')
    const reconnecting: string[] = []
    if (body.okxApiKey || body.okxSecret || body.okxPassphrase) reconnecting.push('OKX')
    if (body.bitgetApiKey || body.bitgetSecret || body.bitgetPassphrase) {
      reconnecting.push('Bitget')
    }
    message.value = reconnecting.length
      ? `Saved. ${reconnecting.join(' + ')} reconnect triggered.`
      : 'Saved.'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function reconnect(ex: Exchange) {
  loading.value = true
  error.value = ''
  message.value = ''
  try {
    await api(`/settings/reconnect?exchange=${ex}`, { method: 'PUT' })
    status.value = await api<Status>('/status')
    message.value = `${exchangeLabel(ex)} reconnect requested.`
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
        <p>Exchange read-only keys + Telegram bot</p>
      </div>
      <div class="actions">
        <button class="secondary" type="button" @click="reconnect('okx')" :disabled="loading">
          Reconnect OKX
        </button>
        <button class="secondary" type="button" @click="reconnect('bitget')" :disabled="loading">
          Reconnect Bitget
        </button>
      </div>
    </div>

    <div v-if="status" class="status">
      <span class="badge" :class="online(status.okx) ? 'ok' : 'err'">
        OKX {{ online(status.okx) ? 'online' : 'offline' }}
      </span>
      <span v-if="settings" class="badge" :class="settings.hasOkx ? 'ok' : 'warn'">
        OKX keys {{ settings.hasOkx ? 'set' : 'missing' }}
      </span>
      <span class="badge" :class="online(status.bitget) ? 'ok' : 'err'">
        Bitget {{ online(status.bitget) ? 'online' : 'offline' }}
      </span>
      <span v-if="settings" class="badge" :class="settings.hasBitget ? 'ok' : 'warn'">
        Bitget keys {{ settings.hasBitget ? 'set' : 'missing' }}
      </span>
      <span v-if="settings" class="badge" :class="settings.hasTelegram ? 'ok' : 'warn'">
        telegram {{ settings.hasTelegram ? 'set' : 'missing' }}
      </span>
      <span v-if="status.okx.lastError" class="error">OKX: {{ status.okx.lastError }}</span>
      <span v-if="status.bitget.lastError" class="error">Bitget: {{ status.bitget.lastError }}</span>
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

      <h2>Bitget</h2>
      <label>
        API Key
        <input v-model="form.bitgetApiKey" :placeholder="settings?.bitgetApiKey || 'API key'" />
      </label>
      <label>
        Secret
        <input v-model="form.bitgetSecret" type="password" :placeholder="settings?.bitgetSecret || 'Secret'" />
      </label>
      <label>
        Passphrase
        <input v-model="form.bitgetPassphrase" type="password" :placeholder="settings?.bitgetPassphrase || 'Passphrase'" />
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
.actions {
  display: flex;
  gap: 0.5rem;
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
