<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import VChart from 'vue-echarts/csp'
import { useUiStore } from '~/stores/ui'

use([CanvasRenderer, BarChart, GridComponent, TooltipComponent])

defineOptions({ name: 'DashboardDailySpendsChart' })

const ui = useUiStore()
const isDark = computed(() => ui.isDark)

const props = withDefaults(
  defineProps<{
    data: Array<{ date: string; label: string; amount: number }>
    periodLabel?: string
    height?: string
  }>(),
  {
    periodLabel: '',
    height: '280px',
  }
)

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

const rupeeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const compactRupeeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
  notation: 'compact',
})

const isEmpty = computed(() => props.data.every((d) => d.amount === 0))

const labels = computed(() => props.data.map((d) => d.label))
const values = computed(() => props.data.map((d) => d.amount))

// For long ranges thin the x-axis so only ~7 labels are shown.
const labelInterval = computed(() => {
  const n = props.data.length
  if (n <= 1) return 0
  return Math.max(1, Math.floor(n / 7))
})

const textColor = computed(() => (isDark.value ? '#FAF7F2' : '#1C1917'))
const mutedColor = computed(() => (isDark.value ? '#A8A29E' : '#78716C'))
const tooltipBg = computed(() => (isDark.value ? '#292524' : '#FFFFFF'))
const tooltipBorder = computed(() => (isDark.value ? '#44403C' : '#EDE7DE'))
const splitLineColor = computed(() => (isDark.value ? '#44403C' : '#F5F1EB'))

const chartOption = computed(() => {
  const reduced = prefersReducedMotion.value
  return {
    animation: !reduced,
    animationDuration: reduced ? 0 : 300,
    animationEasing: 'cubicOut' as const,
    grid: {
      left: 12,
      right: 12,
      top: 24,
      bottom: 24,
      containLabel: true,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: tooltipBg.value,
      borderColor: tooltipBorder.value,
      borderWidth: 1,
      padding: 12,
      textStyle: {
        color: textColor.value,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      extraCssText:
        `box-shadow: 0 4px 12px rgba(${isDark.value ? '0,0,0' : '28, 25, 23'}, 0.08); border-radius: 12px;`,
      formatter: (params: any[]) => {
        const items = Array.isArray(params) ? params : [params]
        const day = items[0]?.name ?? ''
        const amount = Number(items[0]?.value || 0)
        return `
          <div class="font-sans text-xs min-w-[8rem]">
            <div class="font-semibold mb-1.5" style="color:${textColor.value}">${day}</div>
            <div class="flex items-center justify-between gap-4">
              <span style="color:${mutedColor.value}">Spent</span>
              <span class="num font-semibold" style="color:${textColor.value}">${rupeeFormatter.format(amount)}</span>
            </div>
          </div>
        `
      },
    },
    xAxis: {
      type: 'category',
      data: labels.value,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: mutedColor.value,
        fontSize: 11,
        fontFamily: 'Inter, system-ui, sans-serif',
        margin: 12,
        interval: labelInterval.value,
      },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        lineStyle: {
          color: splitLineColor.value,
          type: [4, 4],
        },
      },
      axisLabel: {
        color: isDark.value ? '#D6D3D1' : '#A8A29E',
        fontSize: 11,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        formatter: (value: number) => compactRupeeFormatter.format(value),
      },
    },
    series: [
      {
        name: 'Spends',
        type: 'bar',
        data: values.value,
        barMaxWidth: 18,
        itemStyle: {
          color: '#C2410C',
          borderRadius: [3, 3, 0, 0],
        },
        emphasis: { focus: 'series' },
      },
    ],
  }
})
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center justify-between mb-1">
      <h2 class="font-bold text-ink-900">Daily spends</h2>
      <span v-if="periodLabel" class="text-xs text-ink-500">{{ periodLabel }}</span>
    </div>

    <div
      v-if="isEmpty"
      class="flex flex-col items-center justify-center text-center py-10"
      :style="{ height }"
    >
      <Icon name="lucide:bar-chart-3" class="text-ink-300" size="40" />
      <p class="mt-4 text-sm font-semibold text-ink-700">No spending yet</p>
      <p class="mt-1 text-xs text-ink-500 max-w-[16rem]">
        Spending for this period will appear here once you add transactions.
      </p>
    </div>

    <VChart
      v-else
      :option="chartOption"
      :style="{ height }"
      autoresize
      class="w-full"
    />
  </div>
</template>

<style scoped>
x-vue-echarts {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
}
</style>
