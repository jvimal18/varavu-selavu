<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { use, graphic } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import VChart from 'vue-echarts/csp'
import { useUiStore } from '~/stores/ui'

use([CanvasRenderer, LineChart, GridComponent, LegendComponent, TooltipComponent])

defineOptions({ name: 'DashboardCashFlowChart' })

const ui = useUiStore()
const isDark = computed(() => ui.isDark)

const props = withDefaults(
  defineProps<{
    data: Array<{ month: string; income: number; expense: number }>
    height?: string
  }>(),
  {
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

const isEmpty = computed(() =>
  props.data.every((d) => d.income === 0 && d.expense === 0)
)

const months = computed(() => props.data.map((d) => d.month))
const incomeData = computed(() => props.data.map((d) => d.income))
const expenseData = computed(() => props.data.map((d) => d.expense))

const incomeAreaColor = new graphic.LinearGradient(0, 0, 0, 1, [
  { offset: 0, color: 'rgba(194, 65, 12, 0.35)' },
  { offset: 1, color: 'rgba(194, 65, 12, 0)' },
])

const textColor = computed(() => (isDark.value ? '#FAF7F2' : '#1C1917'))
const mutedColor = computed(() => (isDark.value ? '#A8A29E' : '#78716C'))
const tooltipBg = computed(() => (isDark.value ? '#292524' : '#FFFFFF'))
const tooltipBorder = computed(() => (isDark.value ? '#44403C' : '#EDE7DE'))
const splitLineColor = computed(() => (isDark.value ? '#44403C' : '#F5F1EB'))
const expenseLineColor = computed(() => (isDark.value ? '#A8A29E' : '#44403C'))
const expenseAreaColor = computed(() =>
  new graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: isDark.value ? 'rgba(168, 162, 158, 0.20)' : 'rgba(68, 64, 60, 0.10)' },
    { offset: 1, color: isDark.value ? 'rgba(168, 162, 158, 0)' : 'rgba(68, 64, 60, 0)' },
  ])
)

const chartOption = computed(() => {
  const reduced = prefersReducedMotion.value
  return {
    animation: !reduced,
    animationDuration: reduced ? 0 : 300,
    animationEasing: 'cubicOut' as const,
    grid: {
      left: 12,
      right: 12,
      top: 48,
      bottom: 24,
      containLabel: true,
    },
    legend: {
      data: ['Income', 'Expense'],
      top: 0,
      left: 'center',
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 8,
      itemGap: 20,
      textStyle: {
        color: isDark.value ? '#A8A29E' : '#44403C',
        fontSize: 12,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 500,
      },
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
        const month = items[0]?.name ?? ''
        const income = Number(
          items.find((p) => p.seriesName === 'Income')?.value || 0
        )
        const expense = Number(
          items.find((p) => p.seriesName === 'Expense')?.value || 0
        )
        const net = income - expense
        return `
          <div class="font-sans text-xs min-w-[8rem]">
            <div class="font-semibold mb-1.5" style="color:${textColor.value}">${month}</div>
            <div class="flex items-center justify-between gap-4">
              <span style="color:${mutedColor.value}">Income</span>
              <span class="num font-semibold" style="color:${textColor.value}">${rupeeFormatter.format(income)}</span>
            </div>
            <div class="flex items-center justify-between gap-4 mt-0.5">
              <span style="color:${mutedColor.value}">Expense</span>
              <span class="num font-semibold" style="color:${textColor.value}">${rupeeFormatter.format(expense)}</span>
            </div>
            <div class="mt-2 pt-1.5 border-t flex items-center justify-between gap-4" style="border-color:${isDark.value ? '#44403C' : '#EDE7DE'}">
              <span class="font-medium" style="color:${textColor.value}">Net</span>
              <span class="num font-semibold ${net >= 0 ? 'text-success-700' : 'text-ink-900'}">${rupeeFormatter.format(net)}</span>
            </div>
          </div>
        `
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: months.value,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: mutedColor.value,
        fontSize: 11,
        fontFamily: 'Inter, system-ui, sans-serif',
        margin: 12,
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
        name: 'Income',
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbolSize: 6,
        data: incomeData.value,
        lineStyle: { width: 3, color: '#C2410C' },
        itemStyle: { color: '#C2410C', borderWidth: 2, borderColor: isDark.value ? '#1C1917' : '#FFFFFF' },
        areaStyle: { color: incomeAreaColor },
        emphasis: { focus: 'series', scale: true },
      },
      {
        name: 'Expense',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: expenseData.value,
        lineStyle: { width: 2.5, color: expenseLineColor.value },
        itemStyle: { color: expenseLineColor.value },
        areaStyle: { color: expenseAreaColor.value },
        emphasis: { focus: 'series' },
      },
    ],
  }
})
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center justify-between mb-1">
      <h2 class="font-bold text-ink-900">Cash flow</h2>
      <span class="text-xs text-ink-500">Last 6 months</span>
    </div>

    <div
      v-if="isEmpty"
      class="flex flex-col items-center justify-center text-center py-10"
      :style="{ height }"
    >
      <Icon name="lucide:line-chart" class="text-ink-300" size="40" />
      <p class="mt-4 text-sm font-semibold text-ink-700">No data yet</p>
      <p class="mt-1 text-xs text-ink-500 max-w-[16rem]">
        Income and expenses will appear here once you add transactions.
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
