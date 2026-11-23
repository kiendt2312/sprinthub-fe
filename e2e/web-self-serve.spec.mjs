import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { demoOrigin } from "../scripts/demo-fixture.mjs";

test.use({ locale: "en-US" });

function loseFirstCreateResponse(page, url) {
  const attempts = [];
  const handler = async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const headers = await route.request().allHeaders();
    const upstream = await route.fetch({ maxRetries: 0 });
    attempts.push({
      status: upstream.status(),
      body: route.request().postDataJSON(),
      key: headers["idempotency-key"],
      mutationId: headers["x-client-mutation-id"],
      result: await upstream.json(),
    });
    if (attempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response: upstream });
  };
  return { attempts, install: () => page.route(url, handler), remove: () => page.unroute(url, handler) };
}

function expectReplayedCreate(attempts, body) {
  expect(attempts).toHaveLength(2);
  const [initial, replay] = attempts;
  expect(initial).toMatchObject({ status: 201, body, key: expect.any(String), mutationId: expect.any(String) });
  expect(replay).toMatchObject({
    status: 201,
    body: initial.body,
    key: initial.key,
    mutationId: initial.mutationId,
    result: { data: initial.result.data, seq: initial.result.seq },
  });
  return initial.result.data;
}

test("a new user creates a workspace, project, and first Kanban task", async ({ page }) => {
  test.setTimeout(90_000);
  const run = randomUUID().slice(0, 8);
  const email = `web-self-serve-${run}@example.test`;
  const password = randomUUID();
  const register = page.getByRole("button", { name: "Register", exact: true });
  const emailInput = page.getByLabel("Email", { exact: true });
  const passwordInput = page.getByLabel("Password", { exact: true });
  const accepted = page.getByText("Registration request received. Sign in with your email and password.", { exact: true });
  const board = page.getByRole("region", { name: "Project Kanban" });
  const todo = board.locator('[data-column="TODO"]');

  await test.step("register and return to sign-in without disclosing whether the account exists", async () => {
    await page.goto(`${demoOrigin}/login`);
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(`${demoOrigin}/register`);
    await register.click();
    await expect(page.getByText("Enter a display name of 1 to 80 characters.")).toBeVisible();
    await page.getByLabel("Display name").fill("New board owner");
    await emailInput.fill(email);
    await passwordInput.fill(password);

    const registerEndpoint = "**/api/v1/auth/register";
    for (const [status, code, message] of [
      [403, "REGISTRATION_DISABLED", "Registration is currently disabled."],
      [429, "RATE_LIMITED", "Too many requests. Wait a moment and try again."],
    ]) {
      await page.route(registerEndpoint, (route) => route.fulfill({ status, json: { error: { code } } }), { times: 1 });
      await register.click();
      await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
      await expect(emailInput).toHaveValue(email);
    }

    for (const displayName of ["New board owner", "Another display name"]) {
      if (displayName !== "New board owner") {
        await page.getByRole("link", { name: "Create an account" }).click();
        await page.getByLabel("Display name").fill(displayName);
        await emailInput.fill(email);
        await passwordInput.fill(password);
      }
      const response = page.waitForResponse((entry) => new URL(entry.url()).pathname === "/api/v1/auth/register");
      await register.click();
      expect((await response).status()).toBe(202);
      await expect(page).toHaveURL(`${demoOrigin}/login`);
      await expect(accepted).toBeVisible();
      await expect(emailInput).toHaveValue(email);
      await expect(passwordInput).toHaveValue("");
    }
    await passwordInput.fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${demoOrigin}/workspaces`);
    await expect(page.getByText("You are not a member of any workspace.")).toBeVisible();
  });

  const workspaceName = "First Web Workspace";
  const workspaceSlug = `web-self-serve-${run}`;
  const createWorkspace = page.getByRole("button", { name: "Create workspace", exact: true });
  const workspaceForm = page.getByRole("form", { name: "Create workspace" });
  const workspaceNameField = workspaceForm.getByLabel("Workspace name");
  const slugField = workspaceForm.getByLabel("Slug", { exact: true });
  let workspace;

  await test.step("create a workspace and explicitly retry a lost response", async () => {
    await createWorkspace.click();
    await workspaceNameField.fill("Initial Name");
    await expect(slugField).toHaveValue("initial-name");
    await slugField.fill(workspaceSlug);
    await workspaceNameField.fill(workspaceName);
    await expect(slugField).toHaveValue(workspaceSlug);

    const lost = loseFirstCreateResponse(page, "**/api/v1/workspaces");
    await lost.install();
    await workspaceForm.getByRole("button", { name: "Create workspace" }).click();
    const retry = workspaceForm.getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible();
    await expect(slugField).toHaveValue(workspaceSlug);
    expect(lost.attempts).toHaveLength(1);
    await retry.click();
    await expect(page).toHaveURL(/\/workspaces\/ws_[0-9A-Z]+$/u);
    workspace = expectReplayedCreate(lost.attempts, { name: workspaceName, slug: workspaceSlug });
    await expect(page).toHaveURL(`${demoOrigin}/workspaces/${workspace.id}`);
    await lost.remove();
  });

  await test.step("show a duplicate workspace slug at its field", async () => {
    await page.goto(`${demoOrigin}/workspaces`);
    const link = page.getByRole("link", { name: workspaceName, exact: true });
    await expect(link).toHaveCount(1);
    await createWorkspace.click();
    await workspaceNameField.fill("Another Workspace");
    await slugField.fill(workspaceSlug);
    await workspaceForm.getByRole("button", { name: "Create workspace" }).click();
    await expect(workspaceForm.getByRole("alert")).toHaveText("This slug is already taken.");
    await expect(slugField).toHaveAttribute("aria-invalid", "true");
    await expect(workspaceNameField).toHaveValue("Another Workspace");
    await workspaceForm.getByRole("button", { name: "Cancel" }).click();
    await link.click();
  });

  let projectPath;
  await test.step("create a project and preserve the manually edited project key", async () => {
    const createProject = page.getByRole("button", { name: "Create project", exact: true });
    const form = page.getByRole("form", { name: "Create project" });
    const name = form.getByLabel("Project name");
    const key = form.getByLabel("Project key");
    await expect(page.getByText("This workspace has no active projects.")).toBeVisible();
    await createProject.click();
    await name.fill("Alpha Beta");
    await expect(key).toHaveValue("ALPHABETA");
    await key.fill("FIRST");
    await name.fill("First Project");
    await expect(key).toHaveValue("FIRST");
    const lost = loseFirstCreateResponse(page, `**/api/v1/workspaces/${workspace.id}/projects`);
    await lost.install();
    await form.getByRole("button", { name: "Create project" }).click();
    const retry = form.getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible();
    expect(lost.attempts).toHaveLength(1);
    await retry.click();
    await expect(page).toHaveURL(/\/projects\/prj_[0-9A-Z]+\/board$/u);
    projectPath = new URL(page.url()).pathname;
    const project = expectReplayedCreate(lost.attempts, { name: "First Project", key: "FIRST" });
    expect(projectPath).toBe(`/projects/${project.id}/board`);
    await lost.remove();
    await expect(todo).toBeVisible();
    await expect(todo.locator("[data-task-key]")).toHaveCount(0);

    await page.goto(`${demoOrigin}/workspaces/${workspace.id}`);
    await createProject.click();
    await name.fill("Duplicate Project");
    await key.fill("FIRST");
    await form.getByRole("button", { name: "Create project" }).click();
    await expect(form.getByRole("alert")).toHaveText("This project key is already taken in this workspace.");
    await expect(key).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveValue("Duplicate Project");
    await form.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("link", { name: "First Project", exact: true }).click();
    await expect(page).toHaveURL(`${demoOrigin}${projectPath}`);
  });

  const addTask = page.getByRole("button", { name: "Add task", exact: true });
  const taskForm = page.getByRole("form", { name: "Create task", exact: true });
  const firstCard = todo.locator('[data-task-key="FIRST-1"]');
  const title = "My first task";

  await test.step("retry a lost task create response, then open the focused card and reload the board", async () => {
    const lost = loseFirstCreateResponse(page, `**/api/v1${projectPath.replace(/board$/u, "tasks")}`);
    await lost.install();
    await addTask.click();
    await taskForm.getByLabel("Title", { exact: true }).fill(title);
    await taskForm.getByRole("button", { name: "Create task", exact: true }).click();
    const retry = taskForm.getByRole("button", { name: "Retry creating task", exact: true });
    await expect(retry).toBeVisible();
    expect(lost.attempts).toHaveLength(1);
    await retry.click();
    await expect(firstCard).toContainText(title);
    await expect(firstCard).toBeFocused();
    expect(expectReplayedCreate(lost.attempts, { title }).key).toBe("FIRST-1");
    await lost.remove();
    await expect(taskForm).toHaveCount(0);
    await firstCard.click();
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title);
    await page.goto(`${demoOrigin}${projectPath}`);
    await page.reload();
    await expect(firstCard).toContainText(title);
    await expect(todo.locator("[data-task-key]")).toHaveCount(1);
  });

  await test.step("retry only the board read after a confirmed create", async () => {
    const posts = [];
    await page.route(`**/api/v1${projectPath.replace(/board$/u, "tasks")}`, async (route) => {
      if (route.request().method() === "POST") posts.push(route.request().postDataJSON());
      await route.continue();
    });
    await addTask.click();
    await taskForm.getByLabel("Title", { exact: true }).fill("Saved before refresh failed");
    await page.route(`**/api/v1${projectPath}`, (route) => route.abort("failed"), { times: 1 });
    await taskForm.getByRole("button", { name: "Create task", exact: true }).click();
    await expect(board.getByRole("alert")).toContainText("Task created, but the board could not be refreshed");
    await expect(taskForm).toHaveCount(0);
    await page.getByRole("button", { name: "Retry loading board", exact: true }).click();
    const secondCard = todo.locator('[data-task-key="FIRST-2"]');
    await expect(secondCard).toHaveText(/Saved before refresh failed/u);
    await expect(secondCard).toBeFocused();
    await expect(todo.locator("[data-task-key]")).toHaveCount(2);
    expect(posts).toEqual([{ title: "Saved before refresh failed" }]);
  });
});
