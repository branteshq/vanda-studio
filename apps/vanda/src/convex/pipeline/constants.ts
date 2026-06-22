// Single source of truth for the closed literal sets shared between the Effect
// domain schemas (pipeline/memory.ts, via `Schema.Literals`) and the Convex
// persistence validators (schema.ts, via `v.union(v.literal(...))`).

export const beliefKinds = ["audience", "product", "competitor", "sentiment", "trend"] as const;
export const beliefStatuses = ["active", "decaying", "retired"] as const;
export const momenta = ["rising", "steady", "falling"] as const;
export const accountModes = ["auto", "needs_approval", "manual"] as const;
