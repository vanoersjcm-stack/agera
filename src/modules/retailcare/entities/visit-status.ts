export const VISIT_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

export type VisitStatus = (typeof VISIT_STATUSES)[number];

export function isVisitStatus(value: unknown): value is VisitStatus {
  return typeof value === 'string' && (VISIT_STATUSES as readonly string[]).includes(value);
}

/** COMPLETED and CANCELLED are terminal. */
export const ALLOWED_VISIT_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  PLANNED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['PLANNED', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
