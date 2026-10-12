// The order in which the committee reads its service providers, written once: the switched-on ones first, then by company and by
// contact name. It is the `order by` of the Providers screen (GET /api/admin/providers, server/routes/admin.js), and the Home
// screen (GET /api/admin/home, server/home.js) lists its providers in the same order, so a provider is in the same place on both.
// The alias `p` is the one of `from providers p`. The order is not total (two providers can share a company and a contact name),
// so a list that has to be stable adds `p.id` after it.
export const PROVIDER_LIST_ORDER = 'p.is_active desc, p.company, p.contact_name'
