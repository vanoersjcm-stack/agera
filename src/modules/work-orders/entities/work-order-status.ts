export const WORK_ORDER_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export function isWorkOrderStatus(value: unknown): value is WorkOrderStatus {
  return typeof value === 'string' && (WORK_ORDER_STATUSES as readonly string[]).includes(value);
}

/** COMPLETED and CANCELLED are terminal. */
export const ALLOWED_TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  PENDING: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['PENDING', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
