// Explicit setup allowlist: no student accounts, messages, decisions or history.
export function testTemplate(initial, current) {
  return structuredClone({
    name: current.name, seed: initial.seed,
    days: Math.max(1, Math.ceil((current.plannedEndHour || current.endHour || initial.endHour) / 24)),
    companyNames: current.companies.map(c => c.name),
    revenueAt: initial.accounting?.revenueAt || 'receipt',
    dailyCorporateOverhead: initial.accounting?.dailyCorporateOverhead || 0,
    features: current.features, effects: current.effects, catalog: current.catalog,
    recipe: initial.recipe, secondsPerHour: current.secondsPerHour
  });
}
