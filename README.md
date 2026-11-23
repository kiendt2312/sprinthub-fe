# SprintHub Web

SprintHub's Next.js app. The first desktop demo runs against the local NestJS API and Redis, using a pre-created account, workspace, and project.

## Run locally

Use Node 24 and the pnpm version in the package manifest. From the sibling backend repo, install dependencies and start the local stack with the API on port 3001 and the browser origin on port 3000.

```sh
cd ../sprinthub-be
corepack pnpm install --frozen-lockfile
API_PORT=3001 AUTH_ORIGIN=http://localhost:3000 make up
```

In this repo, install dependencies and start the web app. The rewrite targets `http://127.0.0.1:3001` by default. Set `BACKEND_ORIGIN` to use another API address.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Prepare demo data in another terminal from this repo. Set `SPRINT_HUB_DEMO_EMAIL` and `SPRINT_HUB_DEMO_PASSWORD` in your shell before running the fixture. Use a local test account and a password of 15–128 characters. The fixture uses the public API and creates a fresh workspace and project each run. Leave registration enabled for fixture setup.

```sh
node scripts/demo-fixture.mjs
```

Open [SprintHub](http://localhost:3000/login), sign in with the demo credentials, choose **Alpha Team**, and open **Platform API**. Edit the title and Markdown on a task, move a card between columns, then reorder within a column and reload the board.

## Verify

While the web and API are running as above, run the browser suite against the local stack. The suite creates its own workspace and project and checks session revocation, stale edits, saved content, and board ordering.

```sh
corepack pnpm exec playwright install chromium --only-shell
corepack pnpm test:e2e
```

For repeated runs under the local registration rate limit, set `SPRINT_HUB_E2E_EMAIL` and `SPRINT_HUB_E2E_PASSWORD` to a dedicated existing test account. This skips account registration when seeding the fixture.
