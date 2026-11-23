import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { demoClient, demoOrigin, seedDemo } from "../scripts/demo-fixture.mjs";

const patch = (body) => ({ method: "PATCH", mutation: true, body });

test("desktop demo persists edits and board order, including concurrent changes", async ({ page }) => {
  test.setTimeout(120_000);
  const existingEmail = process.env.SPRINT_HUB_E2E_EMAIL;
  const existingPassword = process.env.SPRINT_HUB_E2E_PASSWORD;
  if (Boolean(existingEmail) !== Boolean(existingPassword)) {
    throw new Error("Set both SPRINT_HUB_E2E_EMAIL and SPRINT_HUB_E2E_PASSWORD to use an existing test account.");
  }
  const email = existingEmail ?? `web-demo-${randomUUID()}@example.test`;
  const password = existingPassword ?? randomUUID();
  const { workspace, project, tasks, profile } = await seedDemo({
    email,
    password,
    createAccount: !existingEmail,
    workspaceName: `Web E2E ${randomUUID().slice(0, 8)}`,
  });
  const secondSession = demoClient();
  const task = tasks[0];
  const boardPath = `/projects/${project.id}/board`;
  const movePath = `/api/v1/tasks/${task.id}/move`;
  const key = task.key;
  const titles = () => page.getByRole("textbox", { name: "Title", exact: true });
  const descriptions = () => page.getByRole("textbox", { name: "Description", exact: true });
  const lane = (column) => page.locator(`[data-column="${column}"]`);
  const card = (taskKey = key) => page.locator(`[data-task-key="${taskKey}"]`);
  const keys = (column) => lane(column).locator("[data-task-key]").evaluateAll(
    (items) => items.map((item) => item.getAttribute("data-task-key")),
  );
  const expectKeys = (column, expected) => expect.poll(() => keys(column)).toEqual(expected);
  const slot = (column, index) => lane(column).locator(`[data-drop-index="${index}"]`);
  const drop = (column, index) => card().dragTo(slot(column, index));
  const moveResponse = () => page.waitForResponse((response) =>
    new URL(response.url()).pathname === movePath && response.request().method() === "PATCH");

  await test.step("sign in through the web origin and open the seeded project", async () => {
    await page.goto(`${demoOrigin}/login`);
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("a deliberately incorrect password");
    const invalid = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v1/auth/login" && response.status() === 401);
    await page.getByRole("button", { name: "Sign in" }).click();
    await invalid;
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
    await page.getByLabel("Password", { exact: true }).fill(password);
    const login = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v1/auth/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    expect((await login).status()).toBe(200);
    await page.locator(`a[href="/workspaces/${workspace.id}"]`).click();
    await page.getByRole("link", { name: project.name, exact: true }).click();
    await expect(page).toHaveURL(`${demoOrigin}${boardPath}`);
    await expectKeys("TODO", tasks.slice(0, 2).map((entry) => entry.key));
    await expectKeys("IN_PROGRESS", tasks.slice(2, 4).map((entry) => entry.key));
    await expect(card().getByTitle(profile.displayName)).toBeVisible();
    await expect(card(tasks[1].key)).toContainText("Unassigned");
    await secondSession("/auth/login", { method: "POST", body: { email, password } });
  });

  await test.step("show permitted destinations when a task is dragged toward a blocked column", async () => {
    const source = await card().boundingBox();
    const target = await slot("DONE", 0).boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    try {
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
      await expect(page.getByRole("status")).toContainText("Move to In progress", { timeout: 2_000 });
      await expect(lane("IN_PROGRESS")).toHaveAttribute("data-drop-allowed", "true");
      await expect(lane("DONE")).toHaveAttribute("data-drop-allowed", "false");
    } finally {
      await page.mouse.up();
    }
    await expectKeys("TODO", tasks.slice(0, 2).map((entry) => entry.key));
  });

  await test.step("move a task directly from its detail, retaining drafts and reflecting the board", async () => {
    const other = tasks[1];
    await card(other.key).click();
    const status = page.getByRole("combobox", { name: "Status", exact: true });
    await expect(status.locator("option")).toHaveText(["To do", "In progress"]);
    await titles().fill("Unsaved local title");
    await secondSession(`/tasks/${other.id}`, patch({ expectedVersion: other.version, title: "Remote title" }));
    await status.selectOption("IN_PROGRESS");
    await expect(page.getByRole("heading", { name: "Latest saved version" })).toBeVisible();
    await expect(titles()).toHaveValue("Unsaved local title");
    await expect(status).toHaveValue("TODO");
    await page.getByRole("button", { name: "Discard draft", exact: true }).click();

    await titles().fill("Draft kept after a successful move");
    await status.selectOption("IN_PROGRESS");
    await expect(page.getByText("Status updated.", { exact: true })).toBeVisible();
    await expect(titles()).toHaveValue("Draft kept after a successful move");
    await page.getByRole("link", { name: "Board", exact: true }).click();
    await expect(lane("IN_PROGRESS").locator(`[data-task-key="${other.key}"]`)).toContainText("Remote title");
    await card(other.key).click();
    await expect(status).toHaveValue("IN_PROGRESS");
    await page.reload();
    await expect(status).toHaveValue("IN_PROGRESS");
    await expect(status.locator("option")).toHaveText(["In progress", "To do", "In review"]);
    await status.selectOption("TODO");
    await expect(page.getByText("Status updated.", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Board", exact: true }).click();
    await expectKeys("TODO", tasks.slice(0, 2).map((entry) => entry.key));
  });

  await test.step("edit and reload a task, then keep the draft after a version conflict", async () => {
    await card().click();
    await expect(titles()).toHaveValue(task.title);
    await titles().fill("Verify Redis recovery after restart");
    const markdown = "## Recovery checklist\n\n<mark>Hidden raw markup</mark>\n\nRun the restart drill.";
    await descriptions().fill(markdown);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Recovery checklist" })).toBeVisible();
    await expect(page.locator("mark")).toHaveCount(0);
    const saved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v1/tasks/${task.id}` && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByText("Changes saved.")).toBeVisible();
    await page.reload();
    await expect(titles()).toHaveValue("Verify Redis recovery after restart");
    await expect(descriptions()).toHaveValue(markdown);

    const base = await secondSession(`/tasks/${task.id}`);
    const draft = "Keep this local draft";
    await titles().fill(draft);
    await secondSession(`/tasks/${task.id}`, patch({ expectedVersion: base.version, title: "Saved by the second session" }));
    const conflict = page.waitForResponse((response) => response.status() === 409);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await conflict;
    await expect(titles()).toHaveValue(draft);
    await page.getByRole("button", { name: "Load latest version", exact: true }).click();
    await expect(page.getByText("Saved by the second session", { exact: true })).toBeVisible();
    await expect(titles()).toHaveValue(draft);
    await page.getByRole("button", { name: "Apply draft to latest version", exact: true }).click();
    await expect.poll(async () => (await secondSession(`/tasks/${task.id}`)).title).toBe(draft);
    await page.goto(`${demoOrigin}${boardPath}`);
    await expect(card()).toContainText(draft);
  });

  await test.step("optimistically place a card between neighbors and persist a same-column reorder", async () => {
    let release;
    const paused = new Promise((resolve) => { release = resolve; });
    const routeMask = `**${movePath}`;
    await page.route(routeMask, async (route) => {
      await paused;
      await route.continue();
    });
    const moved = moveResponse();
    try {
      await drop("IN_PROGRESS", 1);
      await expectKeys("IN_PROGRESS", [tasks[2].key, key, tasks[3].key]);
    } finally {
      release();
    }
    expect((await moved).ok()).toBe(true);
    await page.unroute(routeMask);
    await page.reload();
    await expectKeys("IN_PROGRESS", [tasks[2].key, key, tasks[3].key]);

    const reordered = moveResponse();
    await drop("IN_PROGRESS", 0);
    expect((await reordered).ok()).toBe(true);
    await page.reload();
    await expectKeys("IN_PROGRESS", [key, tasks[2].key, tasks[3].key]);
  });

  await test.step("restore the canonical board after a stale drag is refused", async () => {
    const base = await secondSession(`/tasks/${task.id}`);
    await secondSession(`/tasks/${task.id}`, patch({ expectedVersion: base.version, title: "Latest server title" }));
    const rejected = moveResponse();
    await drop("IN_REVIEW", 1);
    expect((await rejected).status()).toBe(409);
    await expectKeys("IN_PROGRESS", [key, tasks[2].key, tasks[3].key]);
    await expect(card()).toContainText("Latest server title");
  });

  await test.step("reconcile a lost write response without replaying the mutation", async () => {
    let attempts = 0;
    let upstreamStatus;
    const routeMask = `**${movePath}`;
    await page.route(routeMask, async (route) => {
      attempts += 1;
      const upstream = await route.fetch({ maxRetries: 0 });
      upstreamStatus = upstream.status();
      await route.abort("failed");
    });
    const boardMask = `**/api/v1${boardPath}`;
    await page.route(boardMask, (route) => route.abort("failed"), { times: 1 });
    await drop("IN_REVIEW", 1);
    const retryRead = page.getByRole("button", { name: "Retry loading board" });
    await expect(retryRead).toBeVisible();
    await expect(card()).toHaveAttribute("draggable", "false");
    expect(upstreamStatus).toBe(200);
    const canonicalRead = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v1${boardPath}` && response.ok());
    await retryRead.click();
    await canonicalRead;
    await expectKeys("IN_REVIEW", [tasks[4].key, key]);
    expect(attempts).toBe(1);
    await page.unroute(routeMask);
  });

  await test.step("require login again after the session is revoked", async () => {
    const cookies = await page.context().cookies(demoOrigin);
    const activeSession = cookies.find((cookie) => cookie.name === "__Host-sh_session");
    expect(Boolean(activeSession)).toBe(true);
    const revoked = await fetch(`${demoOrigin}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: `${activeSession.name}=${activeSession.value}`,
        Origin: demoOrigin,
        "X-CSRF-Protection": "1",
      },
    });
    expect(revoked.status).toBe(204);
    await page.reload();
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(card()).toHaveCount(0);
    await secondSession("/auth/logout", { method: "POST" });
  });
});
