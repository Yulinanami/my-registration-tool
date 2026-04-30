<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { NCard, NGrid, NGridItem, NStatistic, NSpace, NButton, NTag, useMessage, NDescriptions, NDescriptionsItem } from 'naive-ui';
import { fetchStats, triggerRound, triggerReplenish } from '@/api/client';
import type { Stats } from '@/api/types';
import { formatTimestamp, formatRelative } from '@/utils/format';

const message = useMessage();
const stats = ref<Stats | null>(null);
const loading = ref(false);
const triggering = ref<'round' | 'replenish' | null>(null);
let timer: number | null = null;

async function load() {
  try {
    stats.value = await fetchStats();
  } catch (e) {
    console.error(e);
  }
}

async function onTriggerRound() {
  triggering.value = 'round';
  try {
    await triggerRound();
    message.success('已提交手动检查任务');
    await load();
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } } };
    message.error(`触发失败: ${err.response?.data?.error || '未知错误'}`);
  } finally {
    triggering.value = null;
  }
}

async function onTriggerReplenish() {
  triggering.value = 'replenish';
  try {
    await triggerReplenish();
    message.success('已提交手动补齐任务');
    await load();
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } } };
    message.error(`触发失败: ${err.response?.data?.error || '未知错误'}`);
  } finally {
    triggering.value = null;
  }
}

onMounted(() => {
  load();
  timer = window.setInterval(load, 5000);
});

onUnmounted(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<template>
  <n-space vertical :size="20">
    <n-grid :cols="4" :x-gap="16" :y-gap="16" responsive="screen">
      <n-grid-item>
        <n-card>
          <n-statistic label="可用账号 / 目标">
            <span :style="{ color: stats && stats.activeCount >= stats.target ? '#18a058' : '#f0a020' }">
              {{ stats?.activeCount ?? '-' }} / {{ stats?.target ?? '-' }}
            </span>
          </n-statistic>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card>
          <n-statistic label="总账号数" :value="stats?.totalCount ?? '-'" />
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card>
          <n-statistic label="检查间隔">
            {{ stats?.checkIntervalMinutes ?? '-' }} 分钟
          </n-statistic>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card>
          <n-statistic label="状态">
            <n-tag v-if="stats?.roundInProgress" type="warning">运行中</n-tag>
            <n-tag v-else type="success">空闲</n-tag>
          </n-statistic>
        </n-card>
      </n-grid-item>
    </n-grid>

    <n-card title="调度信息">
      <n-descriptions :column="2" bordered label-placement="left">
        <n-descriptions-item label="进程启动时间">
          {{ formatTimestamp(stats?.startedAt) }}
        </n-descriptions-item>
        <n-descriptions-item label="上轮开始时间">
          {{ formatTimestamp(stats?.lastRoundStartedAt) }}
          <span v-if="stats?.lastRoundStartedAt" style="color: #888; margin-left: 8px;">
            ({{ formatRelative(stats.lastRoundStartedAt, stats.now) }})
          </span>
        </n-descriptions-item>
        <n-descriptions-item label="上轮结束时间">
          {{ formatTimestamp(stats?.lastRoundEndedAt) }}
          <span v-if="stats?.lastRoundEndedAt" style="color: #888; margin-left: 8px;">
            ({{ formatRelative(stats.lastRoundEndedAt, stats.now) }})
          </span>
        </n-descriptions-item>
        <n-descriptions-item label="下轮预计时间">
          {{ formatTimestamp(stats?.nextRoundAt) }}
          <span v-if="stats?.nextRoundAt" style="color: #888; margin-left: 8px;">
            ({{ formatRelative(stats.nextRoundAt, stats.now) }})
          </span>
        </n-descriptions-item>
      </n-descriptions>
    </n-card>

    <n-card v-if="stats?.lastRoundStats" title="最近一轮统计">
      <n-descriptions :column="3" bordered label-placement="left">
        <n-descriptions-item label="检查">{{ stats.lastRoundStats.checked ?? '-' }}</n-descriptions-item>
        <n-descriptions-item label="保留">{{ stats.lastRoundStats.kept ?? '-' }}</n-descriptions-item>
        <n-descriptions-item label="标记">{{ stats.lastRoundStats.marked ?? '-' }}</n-descriptions-item>
        <n-descriptions-item label="清理">{{ stats.lastRoundStats.removed ?? '-' }}</n-descriptions-item>
        <n-descriptions-item label="新增">{{ stats.lastRoundStats.added ?? '-' }}</n-descriptions-item>
        <n-descriptions-item label="尝试">{{ stats.lastRoundStats.attempts ?? '-' }}</n-descriptions-item>
      </n-descriptions>
    </n-card>

    <n-card title="手动操作">
      <n-space>
        <n-button
          type="primary"
          :loading="triggering === 'round'"
          :disabled="!!triggering || stats?.roundInProgress"
          @click="onTriggerRound"
        >
          立即跑一轮 (检查 + 清理 + 补齐)
        </n-button>
        <n-button
          :loading="triggering === 'replenish'"
          :disabled="!!triggering || stats?.roundInProgress"
          @click="onTriggerReplenish"
        >
          立即补齐
        </n-button>
        <n-button :loading="loading" @click="load">刷新</n-button>
      </n-space>
      <p style="color: #888; font-size: 12px; margin-top: 12px;">
        手动任务为后台执行，提交后立即返回。任务执行期间会阻止其他任务并发运行。
      </p>
    </n-card>
  </n-space>
</template>
