<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { use } from 'echarts/core'
import { graphic } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { PieChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent } from 'echarts/components'
import VChart from 'vue-echarts/csp'
import { useUiStore } from '~/stores/ui'
import { formatPaise } from '~/utils/money'

use([CanvasRenderer, PieChart, TitleComponent, TooltipComponent])

const ui = useUiStore()
const isDark = computed(() => ui.isDark)

defineOptions({ name: 'DashboardSpendingDonut' })

const props = withDefaults(
  defineProps<{
    data: Array<{ name: string; value: number; color: string }>
    height?: string
  }>(),
  {
    height: '320px',
  }
)

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

const totalPaise = computed(() => props.data.reduce((sum, item) => sum + item.value, 0))

const chartData = computed(() =>
  props.data.map((item) => ({
    value: item.value,
    name: item.name,
    itemStyle: { color: item.color || '#C2410C' },
  }))
)

const textColor = computed(() => (isDark.value ? '#FAF7F2' : '#1C1917'))
const mutedColor = computed(() => (isDark.value ? '#A8A29E' : '#78716C'))
const tooltipBg = computed(() => (isDark.value ? '#292524' : '#FFFFFF'))
const tooltipBorder = computed(() => (isDark.value ? '#44403C' : '#EDE7DE'))
const labelLineColor = computed(() => (isDark.value ? '#57534E' : '#D6D3D1'))
const itemBorderColor = computed(() => (isDark.value ? '#292524' : '#FFFFFF'))

const chartOption = computed(() => {
  const reduced = prefersReducedMotion.value
  return {
    animation: !reduced,
    animationDuration: reduced ? 0 : 300,
    animationEasing: 'cubicOut' as const,
    animationType: 'scale',
    title: {
      text: 'Total spent',
      subtext: totalPaise.value ? formatPaise(totalPaise.value) : '—',
      left: 'center',
      top: 'center',
      itemGap: 4,
      textStyle: {
        color: mutedColor.value,
        fontSize: 11,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 500,
      },
      subtextStyle: {
        color: textColor.value,
        fontSize: 18,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
      },
    },
    tooltip: {
      trigger: 'item',
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
      formatter: (params: any) => {
        const value = Number(params.value) || 0
        const percent = Number(params.percent) || 0
        return `
          <div class="font-sans text-xs">
            <div class="flex items-center gap-1.5 font-medium" style="color:${textColor.value}">
              <span class="inline-block w-2 h-2 rounded-full" style="background-color:${params.color}"></span>
              ${params.name}
            </div>
            <div class="num mt-1 font-semibold" style="color:${textColor.value}">${formatPaise(value)}</div>
            <div class="text-[11px] mt-0.5" style="color:${mutedColor.value}">${percent.toFixed(0)}% of total</div>
          </div>
        `
      },
    },
    series: [
      {
        name: 'Spending',
        type: 'pie',
        radius: ['58%', '88%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: itemBorderColor.value,
          borderWidth: 2,
        },
        label: {
          show: true,
          position: 'outside',
          formatter: '{b}\n{d}%',
          color: textColor.value,
          fontSize: 12,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 500,
          lineHeight: 16,
        },
        labelLine: {
          length: 10,
          length2: 8,
          lineStyle: { color: labelLineColor.value },
        },
        labelLayout: { hideOverlap: true },
        emphasis: {
          scale: true,
          scaleSize: 6,
          label: { show: true, fontWeight: 600 },
        },
        data: chartData.value,
      },
    ],
  }
})
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center justify-between mb-1">
      <h2 class="font-bold text-ink-900">Spending by category</h2>
    </div>

    <div
      v-if="!data.length"
      class="flex flex-col items-center justify-center text-center py-10"
      :style="{ height }"
    >
      <Icon name="lucide:pie-chart" class="text-ink-300" size="40" />
      <p class="mt-4 text-sm font-semibold text-ink-700">No expenses this month</p>
      <p class="mt-1 text-xs text-ink-500 max-w-[16rem]">
        Add a transaction to see where your money goes.
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
