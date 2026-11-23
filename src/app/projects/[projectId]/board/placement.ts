import type { Board, Status, TaskMove } from "@/lib/api";
import { canDrop } from "@/lib/task-status";

export interface TaskDrag {
  taskId: string;
  from: Status;
}

export function planPlacement(board: Board, drag: TaskDrag, to: Status, index: number) {
  const source = board.columns[drag.from];
  const sourceIndex = source.findIndex((card) => card.id === drag.taskId);

  if (sourceIndex < 0 || !canDrop(drag.from, to) || index < 0 || index > board.columns[to].length) {
    return null;
  }

  const sameColumn = drag.from === to;
  const task = source[sourceIndex];
  const remaining = source.filter((card) => card.id !== task.id);
  const destination = sameColumn ? remaining : board.columns[to];
  // The DOM slot includes the moving card. The API calculates positions without it.
  const position = sameColumn && sourceIndex < index ? index - 1 : index;
  if (sameColumn && position === sourceIndex) return null;

  const afterTaskId = destination[position - 1]?.id;
  const beforeTaskId = destination[position]?.id;
  const payload: TaskMove = { to, expectedVersion: task.version };
  if (afterTaskId) payload.afterTaskId = afterTaskId;
  if (beforeTaskId) payload.beforeTaskId = beforeTaskId;
  return {
    payload,
    optimistic: {
      ...board,
      columns: {
        ...board.columns,
        [drag.from]: remaining,
        [to]: [...destination.slice(0, position), task, ...destination.slice(position)],
      },
    },
  };
}

export function samePlacement(previous: TaskMove, next: TaskMove) {
  return previous.expectedVersion === next.expectedVersion
    && previous.to === next.to
    && previous.afterTaskId === next.afterTaskId
    && previous.beforeTaskId === next.beforeTaskId;
}
