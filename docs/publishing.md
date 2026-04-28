# Publishing

How to distribute BotyTrader as an installable package — including APT (Debian/Ubuntu), npm, and standalone binaries.

## Options at a glance

| Method | `apt install` | No Node required | Effort |
|--------|:---:|:---:|--------|
| **npm global** | No | No | Minimal |
| **GitHub Releases (.deb)** | Manual `dpkg -i` | Yes (binary) | Low |
| **Self-hosted APT repo (GitHub Pages)** | Yes | Yes (binary) | Medium |
| **Launchpad PPA** | Yes (Ubuntu) | Yes (binary) | Medium |
| **Packagecloud.io** | Yes | Yes (binary) | Low (hosted) |

**Recommended path:** compile to a standalone binary → package as `.deb` → host an unofficial APT repo on **GitHub Pages**, automated with **GitHub Actions** on version tags.

This is **not** an official Debian/Ubuntu archive; there is no distro review. Users trust **your** published signing key and metadata.

---

## Maintainer quick path (APT + Pages)

1. **GitHub CLI:** `gh auth login` (repo scope).
2. **One-time signing key + secrets:** from the repo root run  
   `npm run apt:bootstrap-secrets`  
   This generates a dedicated RSA signing key, writes **gitignored** `.apt-gpg-private.asc`, updates `.env` with `APT_GPG_KEY_ID`, and runs `gh secret set` for:
   - `APT_GPG_PRIVATE_KEY` — armored private key (CI only).
   - `APT_GPG_KEY_ID` — optional reference for humans; CI derives the fingerprint after import.
3. **Enable GitHub Pages** (source: **GitHub Actions**):
   `npm run apt:enable-pages`  
   Or set the same under **Settings → Pages** (source: GitHub Actions).
4. **Release:** push a tag `v*` (example `v0.1.0`). Workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) will typecheck, lint, build, compile, build `.deb`, and attach it to a GitHub Release. When that succeeds, [`.github/workflows/apt-pages.yml`](../.github/workflows/apt-pages.yml) runs from `main`, downloads the release `.deb`, generates the signed APT tree into a temporary Pages artifact, and deploys that artifact. No generated release files are committed back to `main`.

**Legacy secret name:** if you already use `GPG_PRIVATE_KEY`, the workflow will use it when `APT_GPG_PRIVATE_KEY` is unset.

---

## How the APT repo is laid out

Source docs and APT configuration live on the **default branch** (usually `main`) under **`docs/`**. After each successful release tag, the APT Pages workflow runs from `main`, copies those files into a Pages artifact, generates the signed APT repository there, and deploys it to `https://<owner>.github.io/<repo>/`.

- **Committed:** [`docs/conf/distributions`](conf/distributions), [`docs/.nojekyll`](.nojekyll), and the Markdown docs next to them.
- **Generated only in the Pages artifact:** reprepro output — `pool/`, `dists/`, `db/` (and `lists/` if present), plus **`public.asc`** (armored **public** key for `apt`).

The private key never appears in the repo, on Pages, or in the install script.

If you previously used a **`gh-pages`** branch or committed generated APT files to `main`, you can remove them after switching Pages to **GitHub Actions**; they are no longer used by this project.

---

## User install (APT)

After the first successful release and Pages build, the project site is:

`https://<owner>.github.io/<repo>/`

Use the root [`install.sh`](../install.sh) (pass `OWNER/REPO` if not running from a git clone):

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh | sudo bash -s -- OWNER/REPO
```

That script installs the keyring from `public.asc`, writes `/etc/apt/sources.list.d/botytrader.list`, runs `apt-get update`, and installs `botytrader`. Later updates are normal:

```bash
sudo apt update && sudo apt upgrade botytrader
```

---

## Build details (local / CI)

### Binary

- `npm run build` — bundle with `tsup`.
- `npm run compile` — single Linux x64 binary with `@yao-pkg/pkg` → `bin/botytrader`.

### `.deb` (CI, on tag)

The release workflow installs Ruby `fpm` and packages `bin/botytrader` into `/usr/local/bin` on **amd64** only (see workflow `fpm` invocation).

---

## GitHub Actions reference

| Step | Location |
|------|----------|
| Tag trigger, checks, `.deb`, Release upload | [`.github/workflows/release.yml`](../.github/workflows/release.yml) |
| Download release `.deb`, build and deploy Pages artifact | [`.github/workflows/apt-pages.yml`](../.github/workflows/apt-pages.yml) |
| `gpg` import, `reprepro` into the temporary Pages artifact | [`scripts/ci-publish-apt.sh`](../scripts/ci-publish-apt.sh) |
| Local key + `gh secret set` | [`scripts/apt-bootstrap-secrets.sh`](../scripts/apt-bootstrap-secrets.sh) |
| `gh api` Pages enable | [`scripts/gh-enable-pages.sh`](../scripts/gh-enable-pages.sh) |

### Secrets

| Name | Purpose |
|------|---------|
| `APT_GPG_PRIVATE_KEY` | Armored secret key used only in Actions to sign repository metadata |
| `APT_GPG_KEY_ID` | Set by bootstrap for your notes; CI does not require it if import succeeds |
| `GITHUB_TOKEN` | Provided automatically; used by release and Pages deployment actions |

Never commit `.env`, `.apt-gpg-private.asc`, or raw private key material.

### Signing key hygiene

- Generate **once** and reuse. Rotating the key invalidates existing installs until users replace `public.asc` / the keyring.
- The bootstrap script creates a **no-passphrase** signing key so `reprepro` can run non-interactively in CI. If you replace it with a passphrase-protected key, you must configure batch signing (e.g. loopback pinentry) yourself.

---

## Manual `.deb` (without APT)

Download the `.deb` from **GitHub Releases** for the tag, then:

```bash
sudo apt install ./botytrader_VERSION_amd64.deb
```

---

## Easier hosted alternative — Packagecloud.io

[Packagecloud](https://packagecloud.io) hosts the APT repo for you. See their docs for `script.deb.sh` and tokens.

---

## npm global

Users with Node.js can install from the registry when published:

```bash
npm install -g botytrader
```

Publishing uses `npm publish` (separate from APT).

---

## Summary

| Task | Tool |
|------|------|
| Bundle TypeScript | `tsup` |
| Compile to native binary | `@yao-pkg/pkg` |
| Create `.deb` | `fpm` (in CI) |
| Host unofficial APT repo | `reprepro` + GitHub Pages Actions artifact |
| Automate | GitHub Actions + [`scripts/ci-publish-apt.sh`](../scripts/ci-publish-apt.sh) |
| Maintainer bootstrap | `npm run apt:bootstrap-secrets` |
| npm distribution | `npm publish` |

## Related docs

- [Development](development.md) — build scripts and local setup.
- [Configuration](configuration.md) — `.env` and `config.toml` (not included in the binary; user-provided at runtime).
