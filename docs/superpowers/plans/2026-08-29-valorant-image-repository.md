# Private VALORANT Image Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `Russelrip/valorant-platform-backend`, publish a signed immutable image from the authorized VALORANT source, and configure Quest to validate that image without deploying or changing the existing VALORANT service.

**Architecture:** The destination repository is a history-preserving private copy of the authorized sibling repository. Its existing application and Dockerfile remain unchanged; its SSH-based CD workflow is retained only after repository identity is updated, while a separate owner-only build workflow publishes, signs, attests, and records the image digest. Quest consumes the digest through protected environment variables and reruns its existing image-build workflow; Compose deployment remains separately disabled and gated.

**Tech Stack:** Git/GitHub CLI, GitHub Actions, Docker Buildx, GHCR, Cosign keyless OIDC, BuildKit SBOM/provenance attestations, Python/uv/PostgreSQL CI.

**Spec:** `docs/superpowers/specs/2026-08-29-valorant-image-repository-design.md`

## Global Constraints

- Source copying is authorized by the user.
- Destination repository is public and owned by `Russelrip`; this supersedes the original private-visibility requirement by explicit user instruction.
- Preserve the authorized sibling repository's current `main` history at the copy point.
- Do not copy secrets into new files; do not print token values, private keys, or environment values containing secrets.
- The new image workflow is build-only, owner-only, and must not configure SSH, invoke a VPS, run migrations, or deploy the VALORANT service.
- Do not invoke the sibling repository's SSH production CD workflow.
- Quest's existing `main` branch and frontend/backend deployment path remain unchanged except for required protected release variables.
- Use PostgreSQL digest `sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0`.
- Accept the VALORANT image only when it matches `^ghcr\.io/russelrip/valorant-platform-backend@sha256:[0-9a-f]{64}$` and comes from a successful build manifest; never derive or guess it from a commit SHA.
- No VPS service state or DNS state may change during this work.

---

### Task 1: Preflight and history-preserving repository copy

**Files:**
- Source read-only: `D:\Work\Projects\valorant-platform-backend\*`
- Destination created remotely: public `Russelrip/valorant-platform-backend`
- Destination local checkout: `D:\Work\Projects\valorant-platform-backend-owner`

**Interfaces:**
- Consumes: authenticated GitHub CLI session for `Russelrip`; clean authorized source checkout; source `main` commit SHA.
- Produces: private destination repository with all source Git history and a recorded copy-point SHA.

- [ ] **Step 1: Verify identity, source state, and authorization boundary**

Run from PowerShell:

```powershell
gh api user --jq '.login'
git -C 'D:\Work\Projects\valorant-platform-backend' status --short --branch
git -C 'D:\Work\Projects\valorant-platform-backend' rev-parse refs/heads/main
git -C 'D:\Work\Projects\valorant-platform-backend' show-ref --heads --tags
```

Expected: the GitHub login is `Russelrip`; the source working tree is clean; `refs/heads/main` resolves to a full SHA; and the source refs can be enumerated without exposing secret values. Abort before repository creation if the identity or source SHA is unexpected.

- [ ] **Step 2: Create the private destination repository**

Run:

```powershell
gh repo create Russelrip/valorant-platform-backend --private --description 'Owner-controlled VALORANT platform image source'
gh api repos/Russelrip/valorant-platform-backend --jq '{full_name,private,default_branch}'
```

Expected: the API reports `full_name` as `Russelrip/valorant-platform-backend`, `private` as `false`, and the repository is not initialized with an unrelated commit.

- [ ] **Step 3: Push the complete authorized Git history**

Use a local mirror so all refs are preserved and no credentials are written into a remote URL:

```powershell
Test-Path -LiteralPath 'D:\Work\Projects'
git clone --mirror 'D:\Work\Projects\valorant-platform-backend' 'D:\Work\Projects\valorant-platform-backend-owner.git'
git -C 'D:\Work\Projects\valorant-platform-backend-owner.git' remote set-url --push origin 'https://github.com/Russelrip/valorant-platform-backend.git'
git -C 'D:\Work\Projects\valorant-platform-backend-owner.git' push --mirror
```

Expected: the push succeeds using the existing Git credential helper or GitHub CLI credential flow; no token appears in the command line or output.

- [ ] **Step 4: Verify source and destination history at the copy point**

Run:

```powershell
$sourceSha = git -C 'D:\Work\Projects\valorant-platform-backend' rev-parse refs/heads/main
$destinationSha = gh api repos/Russelrip/valorant-platform-backend/commits/main --jq '.sha'
if ($sourceSha -ne $destinationSha) { throw "copy-point SHA mismatch: source=$sourceSha destination=$destinationSha" }
gh api repos/Russelrip/valorant-platform-backend --jq '{full_name,private,default_branch}'
git -C 'D:\Work\Projects\valorant-platform-backend-owner.git' fsck --full --no-reflogs
```

Expected: the source and destination `main` SHAs are identical, the destination is public, and mirror integrity succeeds. Record the SHA in the implementation notes and use that exact SHA for later CI/build verification.

- [ ] **Step 5: Commit no Quest changes and preserve a rollback boundary**

Confirm the Quest feature worktree still contains only the already committed design/spec changes:

```powershell
git -C 'D:\Work\Projects\QuestEsports\.worktrees\containerised-vps-deployment' status --short --branch
git -C 'D:\Work\Projects\QuestEsports\.worktrees\containerised-vps-deployment' log --oneline -3
```

Expected: no Quest application or workflow files have changed during repository creation. If destination creation fails, leave Quest variables unchanged and do not retry with a different owner or repository.

### Task 2: Add the owner-only build-only image workflow

**Files:**
- Create: `D:\Work\Projects\valorant-platform-backend-owner\.github\workflows\build-image.yml`
- Modify: `D:\Work\Projects\valorant-platform-backend-owner\.github\workflows\cd.yml:19-20`
- Validate unchanged: `D:\Work\Projects\valorant-platform-backend-owner\Dockerfile`
- Validate unchanged: `D:\Work\Projects\valorant-platform-backend-owner\.github\workflows\ci.yml`

**Interfaces:**
- Consumes: destination `main` commit, successful `ci` workflow run, existing production Dockerfile, GitHub Actions OIDC token.
- Produces: a commit-tagged `ghcr.io/russelrip/valorant-platform-backend` image, its immutable digest, Cosign signature, BuildKit SBOM/provenance attestations, and `valorant-image-release.txt` artifact.

- [ ] **Step 1: Update copied workflow identity without changing deployment behavior**

Change only the copied CD workflow's static Cosign identity from:

```text
https://github.com/naheedroomy/valorant-platform-backend/.github/workflows/cd.yml@refs/heads/main
```

to:

```text
https://github.com/Russelrip/valorant-platform-backend/.github/workflows/cd.yml@refs/heads/main
```

Do not run this workflow. Confirm its SSH steps remain outside the new build-only workflow and that no Quest production deployment behavior is copied into the new workflow.

- [ ] **Step 2: Add the build-only workflow with explicit security boundaries**

Create `.github/workflows/build-image.yml` with this structure. The action SHAs below are the verified pins already used by Quest; Buildx is invoked directly so the build command exposes and captures its digest without adding an unpinned build action:

```yaml
name: Build VALORANT image

on:
  workflow_dispatch:
    inputs:
      source_ref:
        description: Commit, tag, or branch to build
        required: false
        default: main
        type: string

permissions: {}

jobs:
  build:
    if: ${{ github.actor == github.repository_owner }}
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
    env:
      IMAGE_NAME: ghcr.io/${{ github.repository_owner }}/valorant-platform-backend
      SOURCE_REF: ${{ inputs.source_ref || 'main' }}
    steps:
      - name: Check out selected source
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
        with:
          ref: ${{ env.SOURCE_REF }}
          persist-credentials: false

      - name: Verify selected source SHA
        shell: bash
        run: |
          set -euo pipefail
          test "$(git rev-parse --verify HEAD)" = "$(git rev-parse --verify HEAD^{commit})"
          test "${IMAGE_NAME,,}" = ghcr.io/russelrip/valorant-platform-backend

      - name: Verify successful CI for the selected commit
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          set -euo pipefail
          sha="$(git rev-parse HEAD)"
          runs="$(gh run list --repo "$GITHUB_REPOSITORY" --workflow ci --commit "$sha" --status success --limit 1 --json databaseId --jq 'length')"
          test "$runs" = 1

      - name: Log in to GHCR
        uses: docker/login-action@9780b0c442fbb1117ed29e0efdff1e18412f7567 # v3.3.0
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and publish immutable image
        id: image
        shell: bash
        run: |
          set -euo pipefail
          source_sha="$(git rev-parse --verify HEAD)"
          metadata_file="$RUNNER_TEMP/valorant-image-metadata.json"
          docker buildx create --name valorant-image-builder --driver docker-container --use
          docker buildx inspect --bootstrap
          docker buildx build \
            --file Dockerfile \
            --tag "${IMAGE_NAME,,}:$source_sha" \
            --label "org.opencontainers.image.revision=$source_sha" \
            --label "org.opencontainers.image.source=$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" \
            --sbom=true \
            --provenance=mode=max \
            --metadata-file "$metadata_file" \
            --push \
            .
          digest="$(jq -er '."containerimage.digest" | select(test("^sha256:[0-9a-f]{64}$"))' "$metadata_file")"
          printf 'source_sha=%s\n' "$source_sha" >> "$GITHUB_OUTPUT"
          printf 'digest=%s\n' "$digest" >> "$GITHUB_OUTPUT"

      - name: Require an immutable digest
        shell: bash
        env:
          IMAGE_DIGEST: ${{ steps.image.outputs.digest }}
        run: |
          set -euo pipefail
          [[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]

      - name: Install pinned Cosign
        uses: sigstore/cosign-installer@053f9b74638557590800a301da1ba82351507e2c # v3.8.1
        with:
          cosign-release: v2.4.3

      - name: Sign the exact image digest
        env:
          COSIGN_EXPERIMENTAL: '1'
          IMAGE_DIGEST: ${{ steps.image.outputs.digest }}
        shell: bash
        run: |
          set -euo pipefail
          image_ref="${IMAGE_NAME,,}@${IMAGE_DIGEST}"
          [[ "$image_ref" =~ ^ghcr\.io/russelrip/valorant-platform-backend@sha256:[0-9a-f]{64}$ ]]
          cosign sign --yes --oidc-issuer https://token.actions.githubusercontent.com "$image_ref"

      - name: Verify signature and BuildKit attestations
        env:
          COSIGN_EXPERIMENTAL: '1'
          IMAGE_DIGEST: ${{ steps.image.outputs.digest }}
          COSIGN_CERTIFICATE_IDENTITY: https://github.com/Russelrip/valorant-platform-backend/.github/workflows/build-image.yml@refs/heads/main
        shell: bash
        run: |
          set -euo pipefail
          image_ref="${IMAGE_NAME,,}@${IMAGE_DIGEST}"
          cosign verify --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity "$COSIGN_CERTIFICATE_IDENTITY" "$image_ref"
          docker buildx imagetools inspect --raw "$image_ref" > "$RUNNER_TEMP/valorant-image-index.json"
          python3 - "$RUNNER_TEMP/valorant-image-index.json" <<'PY'
          import json
          import sys
          with open(sys.argv[1], encoding="utf-8") as handle:
              index = json.load(handle)
          attestations = [m for m in index.get("manifests", []) if m.get("annotations", {}).get("vnd.docker.reference.type") == "attestation-manifest"]
          if len(attestations) < 2:
              raise SystemExit("expected separate BuildKit SBOM and provenance attestations")
          PY

      - name: Write exact release manifest
        env:
          IMAGE_DIGEST: ${{ steps.image.outputs.digest }}
        shell: bash
        run: |
          set -euo pipefail
          image_ref="${IMAGE_NAME,,}@${IMAGE_DIGEST}"
          printf 'source_sha=%s\nimage=%s\n' "$(git rev-parse HEAD)" "$image_ref" > "$RUNNER_TEMP/valorant-image-release.txt"
          test "$(wc -l < "$RUNNER_TEMP/valorant-image-release.txt")" -eq 2

      - name: Upload exact release manifest
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: valorant-image-release-${{ github.run_id }}-${{ steps.image.outputs.source_sha }}
          path: ${{ runner.temp }}/valorant-image-release.txt
          if-no-files-found: error
          retention-days: 14
```

The workflow must contain no `environment: production`, SSH secret references, `ssh`, `scp`, `systemctl`, `docker compose`, migration command, or VPS path. The `source_ref` input is checked out exactly, while the artifact name uses the run ID and checked-out source SHA so the digest can be recovered without guessing.

- [ ] **Step 3: Validate workflow and source invariants locally**

Run:

```powershell
git -C 'D:\Work\Projects\valorant-platform-backend-owner' diff --check
git -C 'D:\Work\Projects\valorant-platform-backend-owner' grep -n -E 'naheedroomy|PLATFORM_SSH|ssh |scp |systemctl|docker compose|migrations|/opt/quest-esports' -- .github/workflows/build-image.yml
git -C 'D:\Work\Projects\valorant-platform-backend-owner' diff -- Dockerfile .github/workflows/ci.yml
```

Expected: the grep returns no matches; the Dockerfile and CI workflow have no unintended changes; and `git diff --check` is clean.

- [ ] **Step 4: Commit and push only the destination repository changes**

Run:

```powershell
git -C 'D:\Work\Projects\valorant-platform-backend-owner' add .github/workflows/build-image.yml .github/workflows/cd.yml
git -C 'D:\Work\Projects\valorant-platform-backend-owner' diff --cached --check
git -C 'D:\Work\Projects\valorant-platform-backend-owner' commit -m 'ci: add owner-only VALORANT image publishing'
git -C 'D:\Work\Projects\valorant-platform-backend-owner' push origin HEAD:main
```

Expected: the destination `main` receives exactly the identity update and build-only workflow commit. The Quest repository remains untouched.

### Task 3: Run destination CI and publish the signed image

**Files:**
- Read: `D:\Work\Projects\valorant-platform-backend-owner\.github\workflows\ci.yml`
- Read: `D:\Work\Projects\valorant-platform-backend-owner\.github\workflows\build-image.yml`
- Artifact produced remotely: the workflow's `valorant-image-release-${{ github.run_id }}-${{ steps.image.outputs.source_sha }}` artifact.

**Interfaces:**
- Consumes: destination `main` push and owner-only manual dispatch.
- Produces: successful CI run, image digest, verified Cosign proof, verified BuildKit attestations, and release manifest.

- [ ] **Step 1: Wait for destination CI on the pushed source commit**

Run:

```powershell
$destinationSha = gh api repos/Russelrip/valorant-platform-backend/commits/main --jq '.sha'
$ciRun = gh run list --repo Russelrip/valorant-platform-backend --workflow ci --branch main --limit 1 --json databaseId,headSha,status,conclusion | ConvertFrom-Json
if ($ciRun[0].headSha -ne $destinationSha) { throw 'latest CI run is not for destination main' }
gh run watch $ciRun[0].databaseId --repo Russelrip/valorant-platform-backend --exit-status
```

Expected: both `test` and `roles-rls` jobs pass for the destination copy-point-plus-workflow commit. If CI fails, do not dispatch the build workflow.

- [ ] **Step 2: Dispatch the build-only workflow for destination `main`**

Run:

```powershell
gh workflow run build-image.yml --repo Russelrip/valorant-platform-backend --ref main -f source_ref=main
$buildRun = gh run list --repo Russelrip/valorant-platform-backend --workflow build-image.yml --branch main --limit 1 --json databaseId,status,headSha | ConvertFrom-Json
gh run watch $buildRun[0].databaseId --repo Russelrip/valorant-platform-backend --exit-status
```

Expected: the build-only workflow passes all checks and never contains or executes a deployment job.

- [ ] **Step 3: Download and validate the release manifest**

Run:

```powershell
New-Item -ItemType Directory -Path 'D:\Work\Projects\valorant-platform-backend-release' -Force | Out-Null
gh run download $buildRun[0].databaseId --repo Russelrip/valorant-platform-backend --name "valorant-image-release-$($buildRun[0].databaseId)-$($buildRun[0].headSha)" --dir 'D:\Work\Projects\valorant-platform-backend-release'
$manifest = Get-Content -LiteralPath 'D:\Work\Projects\valorant-platform-backend-release\valorant-image-release.txt'
if ($manifest.Count -ne 2) { throw 'release manifest must contain exactly source_sha and image' }
$image = ($manifest | Where-Object { $_ -like 'image=*' }).Substring(6)
if ($image -notmatch '^ghcr\.io/russelrip/valorant-platform-backend@sha256:[0-9a-f]{64}$') { throw "invalid immutable image reference: $image" }
$source = ($manifest | Where-Object { $_ -like 'source_sha=*' }).Substring(11)
if ($source -ne $buildRun[0].headSha) { throw 'manifest source SHA does not equal build SHA' }
```

Expected: one exact immutable image reference is recovered from the artifact, and it is tied to the successful destination build SHA. This value becomes the single source for both Quest VALORANT variables.

### Task 4: Configure protected Quest release variables

**Files:**
- Modify remotely: `Russelrip/QuestEsports`, environment `container-image-build`
- Modify remotely: `Russelrip/QuestEsports`, environment `production-compose` only for approved image references
- Validate unchanged: `COMPOSE_DEPLOY_ENABLED` remains unset or not equal to `true`

**Interfaces:**
- Consumes: exact `image` value from the successful destination release manifest and the independently verified PostgreSQL digest.
- Produces: validated Quest environment values for image building, while leaving Compose cutover disabled.

- [ ] **Step 1: Confirm current protected variable state before mutation**

Run:

```powershell
gh variable list --repo Russelrip/QuestEsports --env container-image-build
gh variable list --repo Russelrip/QuestEsports --env production-compose
```

Expected: values are listed by name only; no secret values are printed. Preserve the current `PRODUCTION_API_URL` and do not change deployment-enable flags.

- [ ] **Step 2: Set exact container-image-build variables**

Using the manifest-derived `$image` variable from Task 3, run:

```powershell
gh variable set PRODUCTION_SITE_URL --repo Russelrip/QuestEsports --env container-image-build --body 'https://questesports.lk'
gh variable set POSTGRES_17_BOOKWORM_DIGEST --repo Russelrip/QuestEsports --env container-image-build --body 'sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0'
gh variable set POSTGRES_IMAGE_APPROVED_REF --repo Russelrip/QuestEsports --env container-image-build --body 'postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0'
gh variable set VALORANT_IMAGE --repo Russelrip/QuestEsports --env container-image-build --body $image
gh variable set VALORANT_IMAGE_APPROVED_REF --repo Russelrip/QuestEsports --env container-image-build --body $image
```

Expected: the two VALORANT values are byte-for-byte identical, and the PostgreSQL approved reference is exactly `postgres:17-bookworm@` plus the verified digest.

- [ ] **Step 3: Set only the approved Compose image references**

Run:

```powershell
gh variable set POSTGRES_IMAGE_APPROVED_REF --repo Russelrip/QuestEsports --env production-compose --body 'postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0'
gh variable set VALORANT_IMAGE_APPROVED_REF --repo Russelrip/QuestEsports --env production-compose --body $image
gh variable list --repo Russelrip/QuestEsports --env production-compose
```

Do not set `COMPOSE_DEPLOY_ENABLED=true`, do not dispatch `deploy-compose.yml`, and do not modify SSH or production host variables.

### Task 5: Rerun Quest image build and verify the release boundary

**Files:**
- Read: `D:\Work\Projects\QuestEsports\.worktrees\containerised-vps-deployment\.github\workflows\build-container-images.yml`
- Read: `D:\Work\Projects\QuestEsports\.worktrees\containerised-vps-deployment\.github\workflows\deploy-compose.yml`
- Remote run: Quest `Build container images` for main SHA `8c781b7`

**Interfaces:**
- Consumes: Quest protected variables and the existing successful Quest CI run for `8c781b7`.
- Produces: successful Quest image build manifest with frontend, backend, migrator, PostgreSQL, and exact VALORANT references; no Compose deployment.

- [ ] **Step 1: Rerun the failed Quest image-build run for the same SHA**

Run:

```powershell
gh run rerun 33231536909 --repo Russelrip/QuestEsports
gh run watch 33231536909 --repo Russelrip/QuestEsports --exit-status
```

Expected: input validation passes; frontend, backend, and migrator images build with SBOM/provenance; each Quest image is signed; the release manifest contains the exact validated VALORANT reference; and the workflow completes successfully for `8c781b7`.

- [ ] **Step 2: Validate the Quest release manifest and signatures**

Run:

```powershell
New-Item -ItemType Directory -Path 'D:\Work\Projects\quest-release-manifest' -Force | Out-Null
$artifactName = gh api repos/Russelrip/QuestEsports/actions/runs/33231536909/artifacts --jq '[.artifacts[] | select(.expired == false and (.name | test("^container-release-manifest-[0-9]+-[0-9a-f]{40}$")))] | .[0].name'
if ($artifactName -notmatch '^container-release-manifest-[0-9]+-[0-9a-f]{40}$') { throw 'successful Quest build manifest artifact was not found' }
gh run download 33231536909 --repo Russelrip/QuestEsports --name $artifactName --dir 'D:\Work\Projects\quest-release-manifest'
Get-Content -LiteralPath 'D:\Work\Projects\quest-release-manifest\release-manifest.txt'
```

Expected: the manifest has the exact required key order, `commit_sha=8c781b7` expanded to the full CI SHA, exact PostgreSQL digest, exact Quest image digests, and the same VALORANT digest configured in both Quest environments. The workflow's Cosign and BuildKit verification steps provide the signature/attestation evidence.

- [ ] **Step 3: Prove Compose deployment did not run**

Run:

```powershell
gh run list --repo Russelrip/QuestEsports --workflow deploy-compose.yml --branch main --limit 5 --json databaseId,status,conclusion,createdAt
gh variable list --repo Russelrip/QuestEsports --env production-compose
```

Expected: no new Compose deployment was dispatched by this work, and `COMPOSE_DEPLOY_ENABLED` is not `true`. Do not query or alter VPS services; the absence of a dispatch and the workflow boundary are the required evidence.

- [ ] **Step 4: Final repository and worktree checks**

Run:

```powershell
git -C 'D:\Work\Projects\QuestEsports\.worktrees\containerised-vps-deployment' status --short --branch
gh api repos/Russelrip/valorant-platform-backend --jq '{full_name,private,default_branch}'
gh run list --repo Russelrip/valorant-platform-backend --workflow ci --branch main --limit 2 --json databaseId,headSha,status,conclusion
gh run list --repo Russelrip/valorant-platform-backend --workflow build-image.yml --branch main --limit 2 --json databaseId,headSha,status,conclusion
```

Expected: the Quest worktree contains only the intended plan/spec documentation changes; the destination is public; destination CI and build runs are successful; and no production service or DNS operation was performed.

## Completion Evidence

The implementation is complete only after recording:

1. Destination repository privacy and source/destination copy-point SHA equality.
2. Destination CI success for the image source commit.
3. Successful build-only workflow run ID and uploaded release manifest.
4. Exact VALORANT digest, Cosign verification identity/issuer, and BuildKit SBOM/provenance verification.
5. Quest environment variable names and exact-value equality checks without exposing secrets.
6. Successful Quest `Build container images` run for the tested full `main` SHA.
7. Evidence that `deploy-compose.yml` was not dispatched and `COMPOSE_DEPLOY_ENABLED` remained disabled.
8. Confirmation that no VPS service state or DNS state changed.
