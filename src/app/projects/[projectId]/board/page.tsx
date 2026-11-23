"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { useProjectContext } from "@/components/project-shell";
import { api, ApiError, errorMessage, isCreateOutcomeUnknown, newMutation } from "@/lib/api";
import type { Board, BoardCard, Profile, Status, TaskMove } from "@/lib/api";
import { canDrop, columns, statusOptions } from "@/lib/task-status";
import { createTaskCopy, createTaskError } from "./create-task-copy";
import { planPlacement, samePlacement } from "./placement";
import type { TaskDrag } from "./placement";
import styles from "./board.module.css";

type Phase = "loading" | "ready" | "saving" | "creating" | "reconciling" | "blocked" | "unavailable" | "expired";

interface DropTarget {
  status: Status;
  index: number;
}

interface PreviousMove {
  payload: TaskMove;
  mutation: ReturnType<typeof newMutation>;
}

interface CreateAttempt {
  payload: Parameters<typeof api.createTask>[1];
  mutation: ReturnType<typeof newMutation>;
}

interface CreateForm {
  title: string;
  error: string;
  retry?: CreateAttempt;
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const unknownMoveMessage = "The move may have been saved. We’re checking the board.";

function boardAccessDenied(error: unknown) {
  return error instanceof ApiError && [403, 404, 423].includes(error.status);
}

function Icon({ name, size = 16 }: { name: "project" | "board" | "calendar" | "priority"; size?: number }) {
  const paths = {
    project: "m9 7-5 5 5 5m6-10 5 5-5 5m-2-13-2 16",
    board: "M3 5h18v14H3z M9 5v14m6-14v14",
    calendar: "M4 6h16v14H4z M8 4v4m8-4v4M4 10h16",
    priority: "M5 19v-4m7 4V9m7 10V4",
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

function Assignee({ assigneeId, profile }: { assigneeId: BoardCard["assigneeId"]; profile: Profile }) {
  if (!assigneeId) return <span className={styles.assignee}>Unassigned</span>;
  if (assigneeId !== profile.id) {
    return <span className={styles.assignee} title={assigneeId}>{assigneeId}</span>;
  }

  const initials = profile.displayName.split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("");
  return <span className={styles.avatar} aria-label={profile.displayName} title={profile.displayName}>{initials}</span>;
}

export default function BoardPage() {
  const { project } = useProjectContext();
  return <ProjectBoard key={project.id} />;
}

function ProjectBoard() {
  const { project, profile } = useProjectContext();
  const copy = createTaskCopy[profile.locale];
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [notice, setNotice] = useState("");
  const [readError, setReadError] = useState("");
  const [archived, setArchived] = useState(Boolean(project.archivedAt));
  const [dragging, setDragging] = useState<TaskDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm | null>(null);
  const [taskToFocus, setTaskToFocus] = useState<string | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const createdCard = useRef<HTMLAnchorElement>(null);
  const drag = useRef<TaskDrag | null>(null);
  const boardLocked = useRef(false);
  const request = useRef(0);
  const previousMoves = useRef(new Map<string, PreviousMove>());

  const expireSession = useCallback(() => {
    setBoard(null);
    setNotice("");
    setReadError("");
    setPhase("expired");
    router.replace("/login");
  }, [router]);

  const loadBoard = useCallback(async (reconciling: boolean) => {
    boardLocked.current = true;
    const current = ++request.current;
    try {
      const snapshot = await api.board(project.id);
      if (request.current !== current) return;
      if (!columns.every(({ status }) => Array.isArray(snapshot?.columns?.[status]))) {
        throw new Error("Missing board columns");
      }
      setBoard(snapshot);
      setReadError("");
      if (reconciling) {
        setNotice((message) => message === unknownMoveMessage
          ? "Board refreshed. The current order is shown below."
          : message);
      }
      boardLocked.current = false;
      setPhase("ready");
    } catch (error) {
      if (request.current !== current) return;
      if (error instanceof ApiError && error.code === "SESSION_INVALID") {
        expireSession();
        return;
      }
      if (boardAccessDenied(error)) setBoard(null);
      setReadError(errorMessage(error));
      boardLocked.current = false;
      setPhase(reconciling ? "blocked" : "unavailable");
    }
  }, [expireSession, project.id]);

  useEffect(() => {
    void loadBoard(false);
    return () => { request.current += 1; };
  }, [loadBoard]);

  const formOpen = createForm !== null;
  useEffect(() => {
    if (formOpen) titleInput.current?.focus();
  }, [formOpen]);

  useEffect(() => {
    if (phase !== "ready" || !taskToFocus) return;
    createdCard.current?.focus();
    setTaskToFocus(null);
  }, [phase, taskToFocus]);

  const canCreate = phase === "ready" && !archived;
  const canSubmitCreate = phase === "ready" && (!archived || Boolean(createForm?.retry));
  const canMove = canCreate && !createForm?.retry;

  function retryBoard() {
    if (boardLocked.current) return;
    const reconciling = phase === "blocked";
    setReadError("");
    setPhase(reconciling ? "reconciling" : "loading");
    void loadBoard(reconciling);
  }

  function cancelCreate() {
    if (!createForm || phase === "creating") return;
    setCreateForm(null);
    if (createForm.retry && phase === "ready" && !boardLocked.current) {
      setPhase("reconciling");
      void loadBoard(true);
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm || !canSubmitCreate || boardLocked.current) return;

    const title = createForm.title.trim();
    if (!createForm.retry && (!title || Array.from(title).length > 200)) {
      setCreateForm({ ...createForm, error: copy.invalidTitle });
      titleInput.current?.focus();
      return;
    }

    const attempt = createForm.retry ?? { payload: { title }, mutation: newMutation() };
    boardLocked.current = true;
    const current = request.current;
    endDrag();
    setCreateForm({ ...createForm, error: "" });
    setNotice("");
    setPhase("creating");

    let taskId: string;
    try {
      const { data } = await api.createTask(project.id, attempt.payload, attempt.mutation);
      taskId = data.id;
    } catch (error) {
      if (request.current !== current) return;
      if (error instanceof ApiError && error.code === "SESSION_INVALID") {
        expireSession();
        return;
      }
      const uncertain = isCreateOutcomeUnknown(error);
      // A rejected retry can fail before the server checks the original write.
      setCreateForm({
        ...createForm,
        error: uncertain ? "" : createTaskError(error, profile.locale),
        retry: uncertain ? attempt : createForm.retry,
      });
      if (error instanceof ApiError && error.code === "PROJECT_ARCHIVED") setArchived(true);
      if (boardAccessDenied(error)) {
        setBoard(null);
        setPhase("reconciling");
        await loadBoard(true);
      } else {
        boardLocked.current = false;
        setPhase("ready");
      }
      return;
    }

    if (request.current !== current) return;
    setCreateForm(null);
    setTaskToFocus(taskId);
    setPhase("reconciling");
    await loadBoard(true);
  }

  function endDrag() {
    drag.current = null;
    setDragging(null);
    setDropTarget(null);
  }

  function beginDrag(event: DragEvent, taskId: string, from: Status) {
    if (!canMove || boardLocked.current) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
    const activeDrag = { taskId, from };
    drag.current = activeDrag;
    setDragging(activeDrag);
  }

  function showDrop(event: DragEvent, status: Status, index: number) {
    if (!drag.current || !canMove || boardLocked.current) return;
    if (!canDrop(drag.current.from, status)) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget((current) => current?.status === status && current.index === index
      ? current
      : { status, index });
  }

  async function move(activeDrag: TaskDrag, to: Status, index: number) {
    if (!board || !canMove || boardLocked.current) return;
    const plan = planPlacement(board, activeDrag, to, index);
    if (!plan) return;
    const { payload, optimistic } = plan;
    const { taskId } = activeDrag;

    // Slots can refer to other cards, so keep one optimistic ordering change in flight.
    boardLocked.current = true;
    const current = request.current;
    const previous = previousMoves.current.get(taskId);
    const replay = previous && samePlacement(previous.payload, payload);
    const mutation = replay ? previous.mutation : newMutation();
    previousMoves.current.delete(taskId);
    setBoard(optimistic);
    setNotice("");
    setPhase("saving");

    try {
      const { data } = await api.moveTask(taskId, payload, mutation);
      if (request.current !== current) return;
      if (replay) {
        // A replay response contains the snapshot from the first accepted write.
        setPhase("reconciling");
        await loadBoard(true);
        return;
      }
      const cards = optimistic.columns[to].map((card) => card.id === taskId ? {
        id: data.id,
        key: data.key,
        title: data.title,
        priority: data.priority,
        assigneeId: data.assigneeId,
        dueAtMs: data.dueAtMs,
        labelIds: data.labelIds,
        version: data.version,
      } : card);
      setBoard({ ...optimistic, columns: { ...optimistic.columns, [to]: cards } });
      boardLocked.current = false;
      setPhase("ready");
    } catch (error) {
      if (request.current !== current) return;
      if (error instanceof ApiError && error.code === "SESSION_INVALID") {
        expireSession();
        return;
      }
      const uncertain = !(error instanceof ApiError) || error.code === "MUTATION_OUTCOME_UNKNOWN"
        || error.status < 400 || error.status >= 500;
      if (uncertain) previousMoves.current.set(taskId, { payload, mutation });
      if (error instanceof ApiError && error.code === "PROJECT_ARCHIVED") setArchived(true);
      setBoard(error instanceof ApiError && error.status === 404 ? null : board);
      setNotice(uncertain ? unknownMoveMessage : errorMessage(error));
      setPhase("reconciling");
      await loadBoard(true);
    }
  }

  function drop(event: DragEvent, status: Status, index: number) {
    const active = drag.current;
    if (!active || !canDrop(active.from, status)) return;
    event.preventDefault();
    endDrag();
    void move(active, status, index);
  }

  function slotAfterMidpoint(event: DragEvent, index: number) {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY >= box.top + box.height / 2 ? index + 1 : index;
  }

  function renderCard(card: BoardCard, status: Status, index: number) {
    const dueDate = card.dueAtMs === null ? null : new Date(card.dueAtMs);
    const dueLabel = dueDate && Number.isFinite(dueDate.getTime()) ? dateFormat.format(dueDate) : "No due date";
    return (
      <Link
        ref={taskToFocus === card.id ? createdCard : undefined}
        href={`/projects/${project.id}/tasks/${card.id}`}
        className={styles.card}
        prefetch={false}
        draggable={canMove}
        data-task-key={card.key}
        data-dragging={dragging?.taskId === card.id || undefined}
        onDragStart={(event) => beginDrag(event, card.id, status)}
        onDragEnd={endDrag}
        onDragOver={(event) => showDrop(event, status, slotAfterMidpoint(event, index))}
        onDrop={(event) => drop(event, status, slotAfterMidpoint(event, index))}
      >
        <span className={styles.cardTop}>
          <span className={styles.issueKey}>{card.key}</span>
          <span className={styles.priority} data-priority={card.priority}>
            <Icon name="priority" size={12} />
            {card.priority.toLowerCase()}
          </span>
        </span>
        <span className={styles.issueTitle}>{card.title}</span>
        <span className={styles.cardFoot}>
          <span className={styles.due}><Icon name="calendar" size={13} />{dueLabel}</span>
          <Assignee assigneeId={card.assigneeId} profile={profile} />
        </span>
      </Link>
    );
  }

  function renderSlot(status: Status, index: number, end: boolean) {
    return (
      <div
        className={styles.dropSlot}
        data-drop-index={index}
        data-end={end || undefined}
        data-active={(dropTarget?.status === status && dropTarget.index === index) || undefined}
        onDragOver={(event) => showDrop(event, status, index)}
        onDrop={(event) => drop(event, status, index)}
      />
    );
  }

  if (phase === "expired") return null;

  const busy = phase === "loading" || phase === "saving" || phase === "creating" || phase === "reconciling";
  const destinations = dragging && statusOptions(dragging.from)
    .map(({ label }) => label)
    .join(" or ");
  return (
    <section className={styles.board} aria-label="Project Kanban" aria-busy={busy}>
      <header className={styles.heading}>
        <span className={styles.projectIcon}><Icon name="project" size={25} /></span>
        <div>
          <h1>{project.name}</h1>
          <span className={styles.projectKey}>{project.key}</span>
        </div>
      </header>
      <div className={styles.viewStrip}>
        <span><Icon name="board" />Kanban</span>
        {!archived && !formOpen && (
          <button type="button" className="sh-button" disabled={!canCreate} onClick={() => {
            if (!boardLocked.current) setCreateForm({ title: "", error: "" });
          }}>{copy.add}</button>
        )}
      </div>
      <div role="status" className={styles.status}>
        {phase === "loading" && "Loading board…"}
        {phase === "saving" && "Saving move…"}
        {phase === "creating" && copy.creating}
        {phase === "reconciling" && (taskToFocus ? copy.refreshing : "Refreshing board… ")}
        {destinations
          ? `Move to ${destinations}, or reorder in the current column.`
          : notice || (archived && !createForm?.error && copy.archived)}
      </div>
      {readError && (
        <div className={styles.readError} role="alert">
          <span>{taskToFocus ? copy.readFailed : readError}</span>
          <button type="button" disabled={busy} onClick={retryBoard}>{copy.retryBoard}</button>
        </div>
      )}
      {createForm && (
        <form className={styles.createForm} aria-label={copy.create} noValidate onSubmit={createTask}>
          <label className={styles.titleField}>
            {copy.title}
            <input
              ref={titleInput}
              type="text"
              name="title"
              required
              value={createForm.title}
              readOnly={phase === "creating" || Boolean(createForm.retry)}
              aria-invalid={createForm.error === copy.invalidTitle || undefined}
              aria-describedby={createForm.error || createForm.retry ? "board-create-error" : undefined}
              onChange={(event) => setCreateForm({ title: event.currentTarget.value, error: "" })}
            />
          </label>
          <div className={styles.createActions}>
            <button type="submit" className="sh-button" disabled={!canSubmitCreate}>
              {createForm.retry ? copy.retryCreate : copy.create}
            </button>
            <button type="button" className="sh-button sh-button-secondary" disabled={phase === "creating"}
              onClick={cancelCreate}>{copy.cancel}</button>
          </div>
          {(createForm.error || createForm.retry) && (
            <p id="board-create-error" className={styles.createError} role="alert">
              {createForm.error}{createForm.error && createForm.retry && " "}
              {createForm.retry && copy.unknownOutcome}
            </p>
          )}
        </form>
      )}
      {board && (
        <div className={styles.lanes} onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
            setDropTarget(null);
          }
        }}>
          {columns.map(({ status, label }) => {
            const cards = board.columns[status];
            return (
              <section
                key={status}
                data-column={status}
                data-drop-allowed={dragging ? canDrop(dragging.from, status) : undefined}
                aria-label={label}
                className={styles.lane}
                onDragOver={(event) => {
                  if (!event.defaultPrevented) showDrop(event, status, cards.length);
                }}
                onDrop={(event) => {
                  if (!event.defaultPrevented) drop(event, status, cards.length);
                }}
              >
                <h2>
                  <span className={styles.dot} aria-hidden="true" />
                  {label}
                  <span className={styles.count}>{cards.length}</span>
                </h2>
                {cards.map((card, index) => (
                  <Fragment key={card.id}>
                    {renderSlot(status, index, false)}
                    {renderCard(card, status, index)}
                  </Fragment>
                ))}
                {renderSlot(status, cards.length, true)}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
