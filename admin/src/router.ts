import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from './api'
import DealsView from './views/DealsView.vue'
import LoginView from './views/LoginView.vue'
import OrdersView from './views/OrdersView.vue'
import SettingsView from './views/SettingsView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    { path: '/', name: 'orders', component: OrdersView },
    { path: '/deals', name: 'deals', component: DealsView },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
})

router.beforeEach((to) => {
  if (!to.meta.public && !getToken()) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && getToken()) {
    return { name: 'orders' }
  }
  return true
})

export default router
