import type { Status } from "./api";

export const columns = [
  { status: "TODO", label: "To do" },
  { status: "IN_PROGRESS", label: "In progress" },
  { status: "IN_REVIEW", label: "In review" },
  { status: "DONE", label: "Done" },
] as const;

const transitions: Record<Status, readonly Status[]> = {
  TODO: ["IN_PROGRESS"],
  IN_PROGRESS: ["TODO", "IN_REVIEW"],
  IN_REVIEW: ["IN_PROGRESS", "DONE"],
  DONE: ["IN_PROGRESS"],
};

export function statusOptions(from: Status) {
  return columns.filter(({ status }) => transitions[from].includes(status));
}

export function canDrop(from: Status, to: Status) {
  return from === to || transitions[from].includes(to);
}
