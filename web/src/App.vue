<script setup lang="ts">
import { computed, h } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import {
  NConfigProvider,
  NLayout,
  NLayoutSider,
  NLayoutHeader,
  NLayoutContent,
  NMenu,
  NIcon,
  NButton,
  NMessageProvider,
  NPopconfirm,
  darkTheme,
  zhCN,
  dateZhCN,
} from 'naive-ui';
import type { MenuOption } from 'naive-ui';
import { logout } from '@/api/client';

const route = useRoute();
const router = useRouter();
const activeKey = computed(() => route.name as string);
const isLoginPage = computed(() => route.name === 'login');

function renderIcon(emoji: string) {
  return () => h(NIcon, null, { default: () => emoji });
}

const menuOptions: MenuOption[] = [
  {
    label: () => h(RouterLink, { to: '/dashboard' }, { default: () => '仪表板' }),
    key: 'dashboard',
    icon: renderIcon('📊'),
  },
  {
    label: () => h(RouterLink, { to: '/accounts' }, { default: () => '账号列表' }),
    key: 'accounts',
    icon: renderIcon('👥'),
  },
  {
    label: () => h(RouterLink, { to: '/logs' }, { default: () => '运行日志' }),
    key: 'logs',
    icon: renderIcon('📝'),
  },
  {
    label: () => h(RouterLink, { to: '/config' }, { default: () => '配置' }),
    key: 'config',
    icon: renderIcon('⚙️'),
  },
];

async function onLogout() {
  await logout();
  router.replace('/login');
}
</script>

<template>
  <n-config-provider :theme="darkTheme" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <!-- 登录页：单独布局 -->
      <RouterView v-if="isLoginPage" />
      <!-- 主布局 -->
      <n-layout v-else has-sider style="height: 100vh">
        <n-layout-sider
          bordered
          :width="220"
          :collapsed-width="64"
          collapse-mode="width"
          show-trigger="bar"
        >
          <div class="sider-brand">账号池守护</div>
          <n-menu :options="menuOptions" :value="activeKey" :indent="18" />
        </n-layout-sider>
        <n-layout>
          <n-layout-header bordered class="page-header">
            <span>{{ (route.meta.title as string) || '' }}</span>
            <n-popconfirm @positive-click="onLogout">
              <template #trigger>
                <n-button size="small" quaternary>退出登录</n-button>
              </template>
              确认退出登录吗？
            </n-popconfirm>
          </n-layout-header>
          <n-layout-content content-style="padding: 20px;">
            <RouterView />
          </n-layout-content>
        </n-layout>
      </n-layout>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.sider-brand {
  padding: 18px 20px;
  font-size: 16px;
  font-weight: 600;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
}
.page-header {
  padding: 14px 24px;
  font-size: 15px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
