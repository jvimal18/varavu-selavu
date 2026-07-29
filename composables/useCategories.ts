/**
 * Categories composable — read-only (seeded), shared state.
 */
export interface Category {
  id: string
  name: string
  icon: string | null
  color: string | null
  parentId: string | null
  type: 'expense' | 'income' | 'both'
  isEssential: boolean
  sortOrder: number
  archived: boolean
  createdAt: string
}

export const useCategories = () => {
  const categories = useState<Category[]>('categories', () => [])
  const loading = useState<boolean>('categories:loading', () => false)

  async function fetchAll() {
    if (categories.value.length > 0) return
    loading.value = true
    try {
      const data = await $fetch<{ categories: Category[] }>('/api/categories')
      categories.value = data.categories
    } finally {
      loading.value = false
    }
  }

  function byId(id: string | null | undefined): Category | undefined {
    if (!id) return undefined
    return categories.value.find((c) => c.id === id)
  }

  function byType(type: 'expense' | 'income'): Category[] {
    return categories.value.filter((c) => c.type === type || c.type === 'both')
  }

  function roots(type?: 'expense' | 'income'): Category[] {
    return categories.value
      .filter((c) => !c.parentId)
      .filter((c) => !type || c.type === type || c.type === 'both')
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }

  function children(parentId: string): Category[] {
    return categories.value
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }

  return { categories, loading, fetchAll, byId, byType, roots, children }
}
