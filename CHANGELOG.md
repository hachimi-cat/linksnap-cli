# Changelog

## 1.4.0
- `linksnap api qr-codes upload-logo --logo <path>`: the generated command uploads the file as `multipart/form-data` (it had no `--logo` and sent nothing), typed from its name the way `linksnap qr upload-logo` does, with this run's credential.

## 1.3.1
- Every command now signs in with `linksnap auth login`'s session: the generated `linksnap api …` commands and the hand-written ones (links, qr, tags, domains, stats, keys, billing, workspace) send its access token, refresh it when it is about to expire, and on a refused token refresh once and retry. Order: an API key given for the run (`--api-key`, `$LINKSNAP_API_KEY`), else the session of `--profile`, else the key saved by `auth token`. (Needs the LinkSnap API that accepts Huudis tokens on `Bearer`.)
- `auth whoami` / `auth status` refresh a stale session and show the signed-in email and workspace (they read `/auth/me`'s `user`).
- `auth token <key>` verifies the key on its workspace (`GET /workspaces/current`); it used `/auth/me`, which refuses keys, so every key was reported as failing.
- `--api-key` now wins over a stored session in commands that use the SDK client too.

## 1.3.0
- An API key (`lsk_…`) goes as `Authorization: ApiKey <key>`, which is what the LinkSnap API reads, on every command that calls the API directly (`linksnap api …`, `qr upload-logo`, downloads). Other tokens stay `Bearer`.
- `linksnap api …` regenerated: webhook endpoints take the API key; Plugipay's billing webhook and the domain provisioner's callback are no longer offered (other systems call them, not customers).

## 1.2.2
- `linksnap api <area> <action>`: every LinkSnap feature route as a command, generated from the API spec (`scripts/apigen.sh`); path parameters as arguments, query and body fields as flags, `--body-json` for the whole body. Uses the same API key, base URL, output and exit codes as the other commands.

## 1.2.1
- Package metadata now points at the public mirror repo (github.com/hachimi-cat/linksnap-cli).
