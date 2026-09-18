# Relayer 0.2.0

Relayer is a self-hosted workspace for recording and carrying forward institution-led
support conversations. It keeps participant information encrypted, preserves consent and
audit records, and gives workers a short briefing before the next conversation.

This repository is a public beta. Each institution should fork it, review the code and
policies, and deploy an isolated environment it controls. Do not use a shared demo or a
development database for real participant data.

## Prerequisites

For a container deployment, install:

- [Git](https://git-scm.com/)
- [Docker Engine or Docker Desktop](https://docs.docker.com/get-docker/) with Docker Compose

For source development only, also install Node.js 22 or newer and pnpm. The production image
already installs its dependencies and serves the built web application and API together.

## Fork, configure, and deploy

1. Fork this repository into an institution-controlled source repository and clone that fork.
2. Before the first application start, choose the institution's deployment label in
   `RELAYER_SLUG`. Optionally set `RELAYER_PUBLIC_URL` to the complete public address. Configure
   the institution's DNS, HTTPS, and access policy outside this repository.
3. Prepare a PostgreSQL database and an environment file outside the checkout. Set the three
   required production variables in the table below. Keep the file owner-readable only; never
   commit it or put its contents in a command line, shell history, log, or screenshot.
4. Build and run the image using the Docker example below. The image runs migrations before it
   starts the server.
5. Open the deployment address and complete the first-signup flow as the institution's
   administrator.

The institution is responsible for its data and secrets, PostgreSQL availability, backups and
restore drills, file-storage retention, access control, consent language, privacy notices,
cross-border processing decisions, and legal or regulatory review. Keep `PII_ENC_KEY` in a
separate protected location from database backups: losing it makes encrypted personal data in
those backups unrecoverable.

## Environment contract

The values below describe the runtime contract. Secret values are intentionally not included.
In production, provide every variable in the required table. Optional integrations remain
disabled unless their complete configuration and the institution's consent and policy allow
them.

### Required in production

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by the application and migrations | None in production; the development code fallback is not suitable for a container deployment |
| `PII_ENC_KEY` | Base64-encoded 32-byte key for encrypting names, contact details, and free text | None; startup or encrypted-data access fails without it |
| `SESSION_SECRET` | Random secret used to sign login session cookies | None; login fails without it |

### Optional AI

| Variable | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key for AI-assisted summaries | Unset; AI is unavailable unless a key is configured (an administrator may also configure the supported OpenAI key through the settings flow) |
| `GEMINI_API_KEY` | Google Gemini API key when Gemini is selected | Unset; Gemini is unavailable without it |
| `AI_PROVIDER` | AI provider: `openai` or `gemini` | `openai` |
| `AI_MODEL` | Provider-specific model name | `gpt-5.5` for OpenAI; `gemini-flash-latest` for Gemini |

### Optional speech-to-text (STT)

| Variable | Purpose | Default |
|---|---|---|
| `VOICE_ENABLED` | Enables voice upload and transcription when set to `1` | Disabled |
| `AZURE_SPEECH_KEY` | Azure Speech credential | Unset; STT unavailable |
| `AZURE_SPEECH_REGION` | Azure Speech resource region | Unset; provide this or `AZURE_SPEECH_ENDPOINT` |
| `AZURE_SPEECH_ENDPOINT` | Azure Speech resource HTTPS endpoint | Unset; provide this or `AZURE_SPEECH_REGION` |
| `STT_PROVIDER` | Provider name recorded in consent metadata | `azure` |
| `STT_CONCURRENCY` | Maximum concurrent transcription jobs | `2` |

STT is active only when `VOICE_ENABLED=1`, `AZURE_SPEECH_KEY`, and either the region or
endpoint are present. The institution must also obtain the required recording and external-STT
consent before sending audio to the provider.

### Optional address, storage, and runtime settings

| Variable | Purpose | Default |
|---|---|---|
| `RELAYER_SLUG` | Deployment label displayed as the institution address when no public URL is set | Unset; choose one before first startup so the address is known |
| `RELAYER_PUBLIC_URL` | Public address displayed in the workspace wizard and institution settings | Unset; when set, it takes precedence over `RELAYER_SLUG` |
| `PORT` | HTTP port served by the API and built web application | `8787` |
| `VOICE_ROOT` | Directory for uploaded voice files | `./voice` |
| `DOC_ROOT` | Directory for uploaded documents | `./documents` |
| `PGSCHEMA` | PostgreSQL schema used by the application | PostgreSQL default schema |

`RELAYER_SLUG` and `RELAYER_PUBLIC_URL` are deployment settings, not fields that the wizard
edits. Mount `VOICE_ROOT` and `DOC_ROOT` on storage covered by the institution's backup and
retention policy when using those features.

See [`docs/secrets.md`](docs/secrets.md) for secret handling and
[`docs/deploy.md`](docs/deploy.md) for operational checks.

## Docker deployment

### Local PostgreSQL for a disposable development environment

The repository's Compose file starts PostgreSQL 17 and publishes it for local development:

```bash
docker compose up -d db
```

The Compose credentials and volume are for a disposable local environment only. Use an
institution-owned PostgreSQL service, credentials, network, backup policy, and storage for
production. The application must be able to reach PostgreSQL before it can serve the wizard;
starting the wizard does not create or change that database connection.

### Build and run

Create an environment file at an institution-controlled path outside the repository. Populate
it with the required variables and any optional settings you have approved, then run:

```bash
docker build -t relayer:0.2.0 .
docker run --env-file <path> -p 8787:8787 relayer:0.2.0
```

`<path>` must point to a file whose `DATABASE_URL` is reachable from the container. Do not
replace `--env-file` with inline `-e` assignments for secrets. The image command is
`node api/src/migrate.ts && node api/src/index.ts`: every container start applies pending
migrations first and only then starts the server. Expose the application through the
institution's approved HTTPS proxy; do not expose PostgreSQL or management ports publicly.

## First signup and workspace setup

The deployment operator chooses `RELAYER_SLUG` and, if desired, `RELAYER_PUBLIC_URL` before
starting the application. The first successful signup against a new, unseeded database creates
the initial administrator. Once that administrator exists, public signup closes and later users
join through administrator invitations.

After signup, the administrator completes the wizard in this order:

1. **Institution workspace** — enter the institution name and confirm the deployment-provided
   slug or public address displayed as a read-only address; it is not changed in the wizard.
2. **Institution information** — add the institution's administrative details.
3. **Programs** — create at least one active program before continuing.
4. **Worker invitations** — invite workers; this step may be skipped and revisited.
5. **External services** — review AI, STT, and database connection status and the setup guidance.

The external-services step verifies the server's current configuration. It does not edit
`DATABASE_URL` or install PostgreSQL. To change the database, the operator updates the runtime
environment, applies the migration/startup procedure, and restarts the application.

AI and STT are disabled by default. AI requires an approved provider key and relevant consent;
STT additionally requires the voice flag, Azure Speech settings, and recording/external-STT
consent. The database is different: no managed or external database integration is
preconnected by this repository, but a reachable PostgreSQL database is required for core
application startup and for the wizard itself.

## Source development and validation

These commands are for local development, not production deployment:

```bash
pnpm install
docker compose up -d db
pnpm migrate
pnpm seed                 # optional synthetic data for local exploration
pnpm dev                  # API and built/static serving when available
pnpm --dir web dev        # Vite development UI in a second terminal
pnpm test                 # API unit tests
pnpm --dir web exec playwright test e2e/beta-flow.spec.ts
```

The browser test expects the API and Vite development servers to be running. Use synthetic
data while validating a new fork, then check `/health`, login, and encrypted record
save/readback without printing secret values.

## Further reading

- [`docs/institution-setup.md`](docs/institution-setup.md) — institution-owned services and
  configuration checklist
- [`docs/secrets.md`](docs/secrets.md) — environment names, generation, rotation, and storage
- [`docs/deploy.md`](docs/deploy.md) — container, address, backup, and recovery guidance

## License

Relayer is released under the [Apache License 2.0](LICENSE). See [`NOTICE`](NOTICE) for
attribution and notices inherited from upstream components.
