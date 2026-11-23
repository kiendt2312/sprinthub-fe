import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ulid } from "ulid";

export const demoOrigin = process.env.SPRINT_HUB_DEMO_ORIGIN ?? "http://localhost:3000";

export function demoClient(origin = demoOrigin) {
  const url = new URL(origin);
  if (url.origin !== origin || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("The demo fixture requires a local origin without a path.");
  }

  let cookie;
  return async function request(path, { method = "GET", body, mutation = false } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (method !== "GET") {
      headers.Origin = origin;
      headers["X-CSRF-Protection"] = "1";
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (mutation) {
      headers["Idempotency-Key"] = randomUUID();
      headers["X-Client-Mutation-Id"] = ulid();
    }

    const result = await fetch(`${origin}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const response = result.status === 204 ? null : await result.json();
    if (!result.ok) {
      throw new Error(`${method} ${path} failed: ${result.status} ${response?.error?.code ?? ""}`.trim());
    }
    if (path === "/auth/login") {
      const sessionHeader = result.headers.getSetCookie().find((header) => header.startsWith("__Host-sh_session="));
      if (!sessionHeader) throw new Error("Login did not return a session cookie.");
      cookie = sessionHeader.split(";", 1)[0];
    }
    return response?.data ?? response;
  };
}

export async function seedDemo({
  email,
  password,
  origin = demoOrigin,
  createAccount = true,
  workspaceName = "Alpha Team",
}) {
  if (!email || !password) throw new Error("Set SPRINT_HUB_DEMO_EMAIL and SPRINT_HUB_DEMO_PASSWORD (15–128 characters).");

  const request = demoClient(origin);
  if (createAccount) {
    await request("/auth/register", { method: "POST", body: { email, password, displayName: "Alex Kim" } });
  }
  const profile = await request("/auth/login", { method: "POST", body: { email, password } });

  try {
    const workspace = await request("/workspaces", {
      method: "POST",
      mutation: true,
      body: { name: workspaceName, slug: `demo-${ulid().toLowerCase()}` },
    });
    const project = await request(`/workspaces/${workspace.id}/projects`, {
      method: "POST",
      mutation: true,
      body: { name: "Platform API", key: "SHAPI", description: "SprintHub desktop demo" },
    });

    const sample = [
      ["Review Redis persistence behavior", "HIGH", []],
      ["Update API docs", "LOW", []],
      ["Document session lifecycle", "MEDIUM", ["IN_PROGRESS"]],
      ["Check workspace access", "MEDIUM", ["IN_PROGRESS"]],
      ["Verify task index", "MEDIUM", ["IN_PROGRESS", "IN_REVIEW"]],
      ["Prepare local demo", "LOW", ["IN_PROGRESS", "IN_REVIEW", "DONE"]],
    ];
    const tasks = [];
    for (const [index, [title, priority, statuses]] of sample.entries()) {
      let task = await request(`/projects/${project.id}/tasks`, {
        method: "POST",
        mutation: true,
        body: index === 0
          ? { title, priority, description: "## Acceptance criteria\n\nRecovery after restart.", assigneeId: profile.id, dueAtMs: Date.UTC(2026, 10, 24) }
          : { title, priority },
      });
      for (const to of statuses) {
        task = await request(`/tasks/${task.id}/move`, {
          method: "PATCH",
          mutation: true,
          body: { to, expectedVersion: task.version },
        });
      }
      tasks.push(task);
    }

    return { project, workspace, tasks, profile };
  } finally {
    await request("/auth/logout", { method: "POST" });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  seedDemo({
    email: process.env.SPRINT_HUB_DEMO_EMAIL,
    password: process.env.SPRINT_HUB_DEMO_PASSWORD,
  }).then(({ project }) => {
    console.log(`Demo project: ${demoOrigin}/projects/${project.id}/board`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
