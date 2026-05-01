import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { getToken } from '@/api/client';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard' },
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { title: '登录', public: true } },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/views/Dashboard.vue'), meta: { title: '仪表板' } },
  { path: '/accounts', name: 'accounts', component: () => import('@/views/Accounts.vue'), meta: { title: '账号列表' } },
  { path: '/logs', name: 'logs', component: () => import('@/views/Logs.vue'), meta: { title: '运行日志' } },
  { path: '/config', name: 'config', component: () => import('@/views/Config.vue'), meta: { title: '配置' } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const isPublic = to.meta?.public === true;
  const hasToken = !!getToken();
  if (!isPublic && !hasToken) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.path === '/login' && hasToken) {
    return { path: '/dashboard' };
  }
  return true;
});
