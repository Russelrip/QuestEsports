# VALORANT Image Repository Design

**Date:** 2026-08-29  
**Status:** Approved for implementation  
**Scope:** Create an owner-controlled private image source for the VALORANT
platform so Quest can reference a verifiable immutable GHCR digest.

## Goal

Create a private `Russelrip/valorant-platform-backend` repository from the
authorized `naheedroomy/valorant-platform-backend` source, preserve its Git
history, and publish a signed immutable image at:

```text
ghcr.io/russelrip/valorant-platform-backend@sha256:<digest>
```

Use that exact digest as Quest's owner-approved `VALORANT_IMAGE` reference.
The existing VALORANT production service must not be stopped, replaced, or
cut over as part of this work.

## Boundaries and safety

- Source copying is authorized by the user.
- Destination repository is private and owned by `Russelrip`.
- The source history is preserved; no secrets are copied into new files.
- The new image workflow is build-only, owner-only, and does not SSH to a VPS.
- The existing sibling CD workflow's deployment behavior is not invoked.
- Quest's existing main branch and frontend/backend deployment path remain
  unchanged except for the release variables needed by the image pipeline.
- The PostgreSQL digest is the independently verified public manifest:
  `sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0`.

## Repository migration

1. Create private `Russelrip/valorant-platform-backend`.
2. Copy the authorized sibling repository's current `main` history into it.
3. Update repository-specific workflow identity and image naming so the new
   repository publishes under `ghcr.io/russelrip/valorant-platform-backend`.
4. Preserve the existing application source, Dockerfile, tests, and runtime
   contract. Do not alter application behavior solely to change ownership.
5. Add a separate build-only workflow instead of reusing the existing workflow
   that performs an SSH production deployment.

## Build-only workflow

The new repository workflow will:

1. Be manually dispatchable and restricted to the repository owner.
2. Check out the selected commit and run the repository's CI checks first.
3. Log in to GHCR using the workflow token with package-write permission.
4. Build the existing production Dockerfile with BuildKit provenance and SBOM.
5. Push an immutable commit tag and capture the resulting digest.
6. Sign the exact image digest with keyless Cosign using GitHub OIDC.
7. Verify the signature identity, issuer, and BuildKit attestations.
8. Print and upload a small release manifest containing the source SHA and
   exact image reference.

The workflow will not configure SSH, modify VPS services, run migrations, or
deploy the VALORANT service. The image digest is not accepted until the build,
signature, and attestation checks succeed.

## Quest configuration flow

After the new workflow succeeds, configure the protected Quest
`container-image-build` environment with:

```text
PRODUCTION_SITE_URL=https://questesports.lk
POSTGRES_17_BOOKWORM_DIGEST=sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0
POSTGRES_IMAGE_APPROVED_REF=postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0
VALORANT_IMAGE=ghcr.io/russelrip/valorant-platform-backend@sha256:<successful-build-digest>
VALORANT_IMAGE_APPROVED_REF=ghcr.io/russelrip/valorant-platform-backend@sha256:<successful-build-digest>
```

The two VALORANT values must be identical. The digest is taken only from the
new repository's successful release manifest, never guessed or derived from a
source commit.

The Quest image-build workflow will then be rerun for the tested `main` SHA.
Compose deployment remains separately gated by its protected environment and
host-readiness checks; this work does not enable or perform the VPS cutover.

## Failure handling

- If repository creation or source publication fails, leave Quest variables
  unchanged.
- If CI, image build, signing, or attestation verification fails, do not use
  the resulting reference and do not configure Quest with it.
- If Quest variable validation fails, keep the existing safe failure state and
  report the exact missing or mismatched variable.
- If any deployment workflow attempts to reach a VPS during the build-only
  phase, stop and treat that as a workflow-boundary defect.

## Verification

The implementation is complete only when all of the following evidence exists:

1. The new private repository exists under `Russelrip` and its source history
   matches the authorized sibling `main` history at the copy point.
2. The new repository's CI passes for the image source commit.
3. The build-only workflow succeeds and uploads a manifest with a full SHA and
   immutable GHCR image reference.
4. Cosign verification succeeds for the exact digest and the new repository's
   workflow identity.
5. Quest environment variables validate, including exact equality between the
   VALORANT image and its approved reference.
6. Quest's Build container images workflow completes successfully for the
   tested Quest `main` SHA.
7. No VPS service state or DNS state changes during this work.

The independent containerized PostgreSQL rehearsal and the eventual Quest
Compose cutover remain separate release gates.
