<script setup lang="ts">
import { computed, h } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import {
  NConfigProvider,
  NLayout,
  NLayoutSider,
  NLayoutHeader,
  NLayoutContent,
  NMenu,
  NIcon,
  NMessageProvider,
  darkTheme,
  zhCN,
  dateZhCN,
} from 'naive-ui';
import type { MenuOption } from 'naive-ui';

const route = useRoute();
const activeKey = computed(() => route.name as string);

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
</script>

<template>
  <n-config-provider :theme="darkTheme" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <n-layout has-sider style="height: 100vh">
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
            {{ (route.meta.title as string) || '' }}
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
}
</style>
