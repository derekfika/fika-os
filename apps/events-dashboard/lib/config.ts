export const EVENT_TYPES=["Client Event","Internal Event","Mobilisation","Training","Coffee Event","Other"] as const;
export const LIFECYCLES=["Draft","Planned","Confirmed","In Progress","Completed","Cancelled"] as const;
export const TASK_STATUSES=["To Do","In Progress","Blocked","Done","Cancelled"] as const;
export const PUBLIC_CONFIG={eventTypes:EVENT_TYPES,lifecycles:LIFECYCLES,taskStatuses:TASK_STATUSES,timezone:"Europe/London"};
