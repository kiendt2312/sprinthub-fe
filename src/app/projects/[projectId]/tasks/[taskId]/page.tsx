"use client";

import { useParams } from "next/navigation";
import { type FormEvent, useCallback, useRef, useState } from "react";
import Markdown from "react-markdown";

import { useProjectContext } from "@/components/project-shell";
import { ResourceError, ResourcePending } from "@/components/shell";
import { useSessionResource } from "@/components/use-session-resource";
import { api, ApiError, errorMessage, newMutation, type Profile, type Status, type Task, type TaskUpdate } from "@/lib/api";

import { columns, statusOptions } from "@/lib/task-status";

import styles from "./task-detail.module.css";

const priorities: Record<Task["priority"], string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

const shortDate = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateWithTime = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type Draft = Pick<Task, "title" | "description">;
type Changes = Pick<TaskUpdate, "title" | "description">;
type Attempt = { body: TaskUpdate; mutation: ReturnType<typeof newMutation> };
type Recovery =
  | { kind: "conflict" }
  | { kind: "unknown"; attempt: Attempt }
  | { kind: "retry"; latest: Task; attempt: Attempt }
  | { kind: "compare"; latest: Task };

function changedFields(task: Task, draft: Draft): Changes {
  const changes: Changes = {};
  const title = draft.title.trim();
  if (title !== task.title) changes.title = title;
  if (draft.description !== task.description) changes.description = draft.description;
  return changes;
}

function draftError(draft: Draft): string | null {
  const titleLength = Array.from(draft.title.trim()).length;
  if (titleLength === 0 || titleLength > 200) return "Use between 1 and 200 characters for the title.";
  if (Array.from(draft.description).length > 20_000) return "Use at most 20,000 characters for the description.";
  return null;
}

function nameOf(id: string, profile: Profile) {
  return id === profile.id ? profile.displayName : id;
}

function dateLabel(ms: number | null, formatter: Intl.DateTimeFormat, fallback: string) {
  if (ms === null) return fallback;
  const date = new Date(ms);
  return Number.isNaN(date.valueOf()) ? fallback : formatter.format(date);
}

function MarkdownPreview({ value }: { value: string }) {
  if (!value.trim()) return <p className={styles.empty}>No description.</p>;
  return (
    <Markdown
      skipHtml
      components={{
        a: ({ href, children }) => href ? <a href={href} rel="noreferrer">{children}</a> : <>{children}</>,
      }}
    >
      {value}
    </Markdown>
  );
}

function TaskProperties({ task, profile, locked, onStatusChange }: {
  task: Task;
  profile: Profile;
  locked: boolean;
  onStatusChange?: (status: Status) => void;
}) {
  const statusLabel = columns.find(({ status }) => status === task.status)?.label ?? task.status;
  const assignee = task.assigneeId === null ? "Unassigned" : nameOf(task.assigneeId, profile);
  return (
    <dl className={styles.properties}>
      <div>
        <dt>Status</dt>
        <dd className={styles.status} data-status={task.status}>
          <span className={styles.dot} aria-hidden="true" />
          {onStatusChange ? (
            <select
              aria-label="Status"
              className={styles.statusSelect}
              value={task.status}
              disabled={locked}
              onChange={(event) => onStatusChange(event.currentTarget.value as Status)}
            >
              <option value={task.status}>{statusLabel}</option>
              {statusOptions(task.status).map(({ status, label }) => (
                <option key={status} value={status}>{label}</option>
              ))}
            </select>
          ) : statusLabel}
        </dd>
      </div>
      <div>
        <dt>Priority</dt>
        <dd className={styles.priority} data-priority={task.priority}>
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M3 12v-2m5 2V7m5 5V4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
          </svg>
          {priorities[task.priority]}
        </dd>
      </div>
      <div>
        <dt>Assignee</dt>
        <dd>
          {task.assigneeId === profile.id && (
            <span className={styles.avatar} aria-hidden="true">
              {profile.displayName.trim().split(/\s+/u).slice(0, 2).map((word) => Array.from(word)[0]).join("")}
            </span>
          )}
          <span>{assignee}</span>
        </dd>
      </div>
      <div>
        <dt>Due date</dt>
        <dd>
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M2.5 4.5h11v9h-11zm0 3h11M5 2.5v4m6-4v4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {dateLabel(task.dueAtMs, shortDate, "No due date")}
        </dd>
      </div>
    </dl>
  );
}

function TaskInformation({ task, profile }: { task: Task; profile: Profile }) {
  return (
    <aside className={styles.information} aria-labelledby="task-information">
      <h2 id="task-information">Task information</h2>
      <dl>
        <div>
          <dt>Available transitions</dt>
          <dd>{statusOptions(task.status).map(({ label }) => label).join(" or ")}</dd>
        </div>
        <div>
          <dt>Reporter</dt>
          <dd>{nameOf(task.reporterId, profile)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{dateLabel(task.createdAtMs, dateWithTime, task.createdAt)}</dd>
        </div>
        <div>
          <dt>Version / last sequence</dt>
          <dd>{task.version} / {task.lastSeq}</dd>
        </div>
      </dl>
    </aside>
  );
}

function TaskEditor({
  initialTask,
  profile,
  archived,
  readTask,
}: {
  initialTask: Task;
  profile: Profile;
  archived: boolean;
  readTask: () => Promise<Task>;
}) {
  const [task, setTask] = useState(initialTask);
  const [draft, setDraft] = useState<Draft>({ title: initialTask.title, description: initialTask.description });
  const [tab, setTab] = useState<"write" | "preview">(archived ? "preview" : "write");
  const [busy, setBusy] = useState(false);
  const [statusNeedsRefresh, setStatusNeedsRefresh] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const changes = changedFields(task, draft);
  const hasChanges = Object.keys(changes).length > 0;

  function accept(latest: Task, message: string) {
    setTask(latest);
    setDraft({ title: latest.title, description: latest.description });
    setRecovery(null);
    setError("");
    setNotice(message);
  }

  async function write(attempt: Attempt) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api.updateTask(task.id, attempt.body, attempt.mutation);
      accept(data, "Changes saved.");
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "SESSION_INVALID") return;
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.code === "TASK_VERSION_CONFLICT") {
        setRecovery({ kind: "conflict" });
      } else if (!(cause instanceof ApiError) || cause.status >= 500 || cause.status < 300) {
        setRecovery({ kind: "unknown", attempt });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function loadLatest() {
    if (inFlight.current || recovery === null) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const latest = await readTask();
      if (recovery.kind === "unknown") {
        const { attempt } = recovery;
        const { title, description } = attempt.body;
        if ((title === undefined || title === latest.title) && (description === undefined || description === latest.description)) {
          accept(latest, "The latest task includes your changes.");
          return;
        }
        if (latest.version === attempt.body.expectedVersion) {
          setRecovery({ kind: "retry", latest, attempt });
          return;
        }
      }
      setRecovery({ kind: "compare", latest });
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.code !== "SESSION_INVALID") setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function refreshAfterStatusChange() {
    try {
      const latest = await readTask();
      setStatusNeedsRefresh(false);
      if (hasChanges && (latest.title !== task.title || latest.description !== task.description)) {
        setRecovery({ kind: "compare", latest });
        return;
      }
      if (hasChanges) setTask(latest);
      else accept(latest, "");
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "SESSION_INVALID") return;
      setStatusNeedsRefresh(true);
      setError(errorMessage(cause));
    }
  }

  async function changeStatus(to?: Status) {
    if (inFlight.current || archived || recovery) return;
    if (to !== undefined && (statusNeedsRefresh || !statusOptions(task.status).some(({ status }) => status === to))) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (to === undefined) {
        await refreshAfterStatusChange();
        return;
      }
      const { data } = await api.moveTask(task.id, { to, expectedVersion: task.version });
      setTask(data);
      setNotice("Status updated.");
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "SESSION_INVALID") return;
      if (!(cause instanceof ApiError) || cause.status >= 500 || cause.status < 300
        || cause.code === "TASK_VERSION_CONFLICT" || cause.code === "INVALID_STATUS_TRANSITION") {
        await refreshAfterStatusChange();
      }
      setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || archived || recovery || statusNeedsRefresh || !hasChanges) return;
    const validation = draftError(draft);
    if (validation) {
      setError(validation);
      return;
    }
    void write({ body: { expectedVersion: task.version, ...changes }, mutation: newMutation() });
  }

  function applyDraft(latest: Task) {
    const nextDraft = { title: latest.title, description: latest.description, ...changes };
    const validation = draftError(nextDraft);
    if (validation) {
      setError(validation);
      return;
    }
    const nextChanges = changedFields(latest, nextDraft);
    if (!Object.keys(nextChanges).length) {
      accept(latest, "The latest task already includes your changes.");
      return;
    }
    void write({ body: { expectedVersion: latest.version, ...nextChanges }, mutation: newMutation() });
  }

  const visibleTask = recovery?.kind === "compare" || recovery?.kind === "retry" ? recovery.latest : task;
  const readOnly = archived || busy || recovery?.kind === "unknown" || recovery?.kind === "retry";

  return (
    <form className={styles.detail} onSubmit={save} aria-label="Task details">
      <header className={styles.titleGroup}>
        <div className={styles.actions}>
          <span className={styles.key}>{task.key}</span>
          {!archived && (
            <button type="submit" className={styles.primary} disabled={busy || recovery !== null || statusNeedsRefresh || !hasChanges}>
              {busy ? "Working…" : "Save changes"}
            </button>
          )}
        </div>
        {archived ? (
          <h1 className={styles.title}>{task.title}</h1>
        ) : (
          <h1 className={styles.title} aria-label={visibleTask.title}>
            <input
              aria-label="Title"
              value={draft.title}
              onChange={(event) => {
                setDraft({ ...draft, title: event.target.value });
                setNotice("");
              }}
              readOnly={readOnly}
              required
            />
          </h1>
        )}
      </header>

      <TaskProperties
        task={visibleTask}
        profile={profile}
        locked={busy || recovery !== null || statusNeedsRefresh}
        onStatusChange={archived ? undefined : (status) => void changeStatus(status)}
      />
      {statusNeedsRefresh && (
        <div className={styles.recovery}>
          <p>Reload the task before trying another change.</p>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void changeStatus()}>
            Reload task
          </button>
        </div>
      )}
      {archived && <p role="status" className={styles.feedback}>This project is archived. Task details are read-only.</p>}
      {error && <p role="alert" className={styles.feedback}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {recovery && (
        <section className={styles.recovery} aria-label="Resolve save">
          {(recovery.kind === "conflict" || recovery.kind === "unknown") && (
            <>
              <p>
                {recovery.kind === "conflict"
                  ? "This task was updated while you were editing. Your draft is still here."
                  : "We lost confirmation of your save. Check the latest version before trying again."}
              </p>
              <button type="button" className={styles.secondary} onClick={() => void loadLatest()} disabled={busy}>
                Load latest version
              </button>
            </>
          )}
          {recovery.kind === "retry" && (
            <>
              <p>Your changes are still in the draft. You can retry the original save.</p>
              <button type="button" className={styles.secondary} onClick={() => void write(recovery.attempt)} disabled={busy}>
                Retry save
              </button>
              <button type="button" className={styles.textButton} onClick={() => accept(recovery.latest, "Latest version loaded.")} disabled={busy}>
                Discard draft
              </button>
            </>
          )}
          {recovery.kind === "compare" && (
            <>
              <h2>Latest saved version</h2>
              <p className={styles.latestTitle}>{recovery.latest.title}</p>
              <div className={styles.markdown}><MarkdownPreview value={recovery.latest.description} /></div>
              <button type="button" className={styles.secondary} onClick={() => applyDraft(recovery.latest)} disabled={busy}>
                Apply draft to latest version
              </button>
              <button type="button" className={styles.textButton} onClick={() => accept(recovery.latest, "Latest version loaded.")} disabled={busy}>
                Discard draft
              </button>
            </>
          )}
        </section>
      )}

      <div className={styles.body}>
        <section aria-labelledby="description-heading">
          <h2 id="description-heading">
            {tab === "write" ? <label htmlFor="task-description">Description</label> : "Description"}
          </h2>
          {!archived && <p className={styles.format}>Markdown</p>}
          <div className={styles.editor}>
            {!archived && (
              <div className={styles.tabs} role="group" aria-label="Description view">
                <button type="button" aria-pressed={tab === "write"} onClick={() => setTab("write")}>Write</button>
                <button type="button" aria-pressed={tab === "preview"} onClick={() => setTab("preview")}>Preview</button>
              </div>
            )}
            {tab === "write" ? (
              <textarea
                id="task-description"
                value={draft.description}
                onChange={(event) => {
                  setDraft({ ...draft, description: event.target.value });
                  setNotice("");
                }}
                readOnly={readOnly}
                rows={5}
              />
            ) : (
              <div className={styles.markdown} aria-label="Description preview">
                <MarkdownPreview value={draft.description} />
              </div>
            )}
          </div>
          {tab === "write" && (
            <div className={styles.rendered} aria-labelledby="rendered-heading">
              <h3 id="rendered-heading">Rendered preview</h3>
              <div className={styles.markdown}><MarkdownPreview value={draft.description} /></div>
            </div>
          )}
        </section>
        <TaskInformation task={visibleTask} profile={profile} />
      </div>
    </form>
  );
}

function TaskRoute({ taskId }: { taskId: string }) {
  const { project, profile } = useProjectContext();
  const projectId = project.id;
  const readTask = useCallback(async () => {
    const latest = await api.task(taskId);
    if (latest.projectId !== projectId) throw new ApiError("NOT_FOUND", 404);
    return latest;
  }, [projectId, taskId]);
  const { state, retry } = useSessionResource(readTask);

  if (state.kind === "pending") return <ResourcePending label="Loading task…" />;
  if (state.kind === "error") return <ResourceError message={state.message} retry={retry} />;

  return (
    <TaskEditor
      initialTask={state.data}
      profile={profile}
      archived={project.archivedAt !== null}
      readTask={readTask}
    />
  );
}

export default function TaskPage() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
  return <TaskRoute key={`${projectId}/${taskId}`} taskId={taskId} />;
}
