// Provisório: substituído pelo módulo de relatórios.
import type { Store } from '../../lib/types'
export function ReportsHome({ store }: { store: Store }) {
  return <p>Relatórios de {store.name}</p>
}
export function ReportView({ store }: { store: Store }) {
  return <p>Relatório de {store.name}</p>
}
