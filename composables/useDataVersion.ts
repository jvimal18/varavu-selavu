/**
 * Shared "data version" counter. Bumped by mutations (create/update/delete);
 * pages and the dashboard watch it and refetch.
 *
 * This solves the auto-refresh problem when a mutation happens in a component
 * that's a sibling/ancestor of the page (e.g. QuickAddModal in the layout).
 */
export const useDataVersion = () => {
  const version = useState<number>('data:version', () => 0)
  function bump() { version.value++ }
  return { version, bump }
}
