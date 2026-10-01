# Changelog

## 1.3.0
- An API key (`lsk_…`) goes as `Authorization: ApiKey <key>`, which is what the LinkSnap API reads, on every command that calls the API directly (`linksnap api …`, `qr upload-logo`, downloads). Other tokens stay `Bearer`.
- `linksnap api …` regenerated: webhook endpoints take the API key; Plugipay's billing webhook and the domain provisioner's callback are no longer offered (other systems call them, not customers).

## 1.2.2
- `linksnap api <area> <action>`: every LinkSnap feature route as a command, generated from the API spec (`scripts/apigen.sh`); path parameters as arguments, query and body fields as flags, `--body-json` for the whole body. Uses the same API key, base URL, output and exit codes as the other commands.

## 1.2.1
- Package metadata now points at the public mirror repo (github.com/hachimi-cat/linksnap-cli).
