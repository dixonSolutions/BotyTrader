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

**Recommended path:** compile to a standalone binary → package as `.deb` → host an APT repo on GitHub Pages, all automated with GitHub Actions.

---

## Step 1 — Build a self-contained binary

Using `@yao-pkg/pkg` (maintained fork of `pkg`) to bundle the TypeScript output and embed a Node.js runtime into a single executable. This means users do **not** need Node.js installed.

```bash
pnpm add -D tsup @yao-pkg/pkg
```

Add to `package.json`:

```json
{
  "scripts": {
    "build":    "tsup src/main.ts --format cjs --out-dir dist",
    "compile":  "pkg dist/main.js --target node20-linux-x64 --output bin/botytrader"
  }
}
```

`tsup` bundles TypeScript → CommonJS. `pkg` compiles that bundle + Node runtime → a single native binary `bin/botytrader`.

> **Ink and TTY:** Ink relies on raw TTY access. Verify the compiled binary works in a real terminal after first compilation — some Ink internals can need `--no-bytecode` flag on older pkg versions.

---

## Step 2 — Create a `.deb` package with `fpm`

[fpm](https://fpm.readthedocs.io/) (Effing Package Management) is the easiest way to create `.deb` (and `.rpm`, `.apk`, etc.) packages without writing `debian/control` files by hand.

```bash
# Install fpm (requires Ruby)
gem install fpm
```

Package the binary:

```bash
fpm \
  --input-type dir \
  --output-type deb \
  --name botytrader \
  --version 1.0.0 \
  --architecture amd64 \
  --description "Terminal-based AI trading assistant" \
  --maintainer "Your Name <you@example.com>" \
  --url "https://github.com/your-org/botytrader" \
  --prefix /usr/local/bin \
  bin/botytrader
```

This produces `botytrader_1.0.0_amd64.deb`. Users can install it immediately:

```bash
sudo dpkg -i botytrader_1.0.0_amd64.deb
botytrader   # launches TUI
```

---

## Step 3 — Host an APT repository on GitHub Pages

This gives users a proper `apt install botytrader` experience.

### 3a. Tools

```bash
# Install reprepro (manages the APT repo structure)
sudo apt install reprepro gnupg
```

### 3b. Generate a GPG signing key

```bash
gpg --full-generate-key   # RSA 4096, no expiry
gpg --list-keys           # note the key ID
gpg --armor --export YOUR_KEY_ID > public.asc
```

The public key (`public.asc`) must be published so users can trust the repo.

### 3c. Initialise the repo

```
apt-repo/
├── conf/
│   └── distributions        ← reprepro config
└── (reprepro generates the rest)
```

`conf/distributions`:

```
Origin: BotyTrader
Label: BotyTrader
Codename: stable
Architectures: amd64 arm64
Components: main
Description: BotyTrader APT repository
SignWith: YOUR_KEY_ID
```

Add a `.deb` and generate the repo index:

```bash
reprepro -b apt-repo includedeb stable botytrader_1.0.0_amd64.deb
```

### 3d. Publish to GitHub Pages

Push the `apt-repo/` directory to a `gh-pages` branch (or `docs/` on main) and enable Pages in the repo settings.

Users then add the repo once:

```bash
curl -fsSL https://your-org.github.io/botytrader/public.asc | \
  sudo gpg --dearmor -o /etc/apt/keyrings/botytrader.gpg

echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/botytrader.gpg] \
  https://your-org.github.io/botytrader stable main" | \
  sudo tee /etc/apt/sources.list.d/botytrader.list

sudo apt update
sudo apt install botytrader
```

---

## Step 4 — Automate with GitHub Actions

Place this workflow at `.github/workflows/release.yml`. It runs on every version tag (`v*`) and:

1. Builds the binary.
2. Creates the `.deb`.
3. Publishes to GitHub Releases.
4. Updates the APT repo on GitHub Pages.

```yaml
name: Release

on:
  push:
    tags: ["v*"]

jobs:
  build-and-publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Build bundle
        run: npm run build

      - name: Compile binary
        run: npm run compile

      - name: Package .deb
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          gem install fpm --no-document
          fpm \
            --input-type dir \
            --output-type deb \
            --name botytrader \
            --version "$VERSION" \
            --architecture amd64 \
            --description "Terminal-based AI trading assistant" \
            --prefix /usr/local/bin \
            bin/botytrader
          echo "DEB=botytrader_${VERSION}_amd64.deb" >> $GITHUB_ENV

      - name: Upload to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: ${{ env.DEB }}

      - name: Update APT repo (gh-pages)
        env:
          GPG_PRIVATE_KEY: ${{ secrets.GPG_PRIVATE_KEY }}
          GPG_KEY_ID: ${{ secrets.GPG_KEY_ID }}
        run: |
          echo "$GPG_PRIVATE_KEY" | gpg --import
          git config user.email "ci@github.com"
          git config user.name "GitHub Actions"
          git fetch origin gh-pages
          git checkout gh-pages
          reprepro -b . includedeb stable "$DEB"
          git add .
          git commit -m "APT: add $DEB"
          git push origin gh-pages
```

Store `GPG_PRIVATE_KEY` (exported with `gpg --armor --export-secret-keys YOUR_KEY_ID`) and `GPG_KEY_ID` as GitHub Actions secrets.

---

## Easier hosted alternative — Packagecloud.io

[Packagecloud](https://packagecloud.io) hosts the APT repo for you, removing the need to manage GPG keys, `reprepro`, and GitHub Pages manually. It has a free tier for open-source projects.

1. Create a Packagecloud account and repository (e.g. `your-org/botytrader`).
2. Install the CLI: `gem install package_cloud`.
3. Push the `.deb`:

```bash
package_cloud push your-org/botytrader/ubuntu/jammy botytrader_1.0.0_amd64.deb
```

Users install with:

```bash
curl -s https://packagecloud.io/install/repositories/your-org/botytrader/script.deb.sh | sudo bash
sudo apt install botytrader
```

Packagecloud can also be called from GitHub Actions using `PACKAGECLOUD_TOKEN`.

---

## Also publish to npm

Users comfortable with Node.js can install without APT:

```bash
npm install -g botytrader
```

Add to `package.json`:

```json
{
  "name": "botytrader",
  "version": "1.0.0",
  "bin": {
    "botytrader": "./dist/main.js"
  },
  "files": ["dist/"]
}
```

Publish:

```bash
npm login
npm publish --access public
```

This distribution requires the user to have Node.js installed; the APT/binary path does not.

---

## Summary

| Task | Tool |
|------|------|
| Bundle TypeScript | `tsup` |
| Compile to native binary | `@yao-pkg/pkg` |
| Create `.deb` | `fpm` |
| Host APT repo (self) | `reprepro` + GitHub Pages |
| Host APT repo (managed) | Packagecloud.io |
| Automate everything | GitHub Actions |
| npm distribution | `npm publish` |

## Related docs

- [Development](development.md) — build scripts and local setup.
- [Configuration](configuration.md) — `.env` and `config.toml` (not included in the binary; user-provided at runtime).
