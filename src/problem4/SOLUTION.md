# Problem 4: Ship It Twice

## 1. Architecture Summary

Automated, secure CI/CD pipelines using **GitHub Actions**:
- **Backend API**: Deployed to **AWS EC2 Graviton5 (`c9g.large` / `c9g.xlarge`)** running Bun runtime on Ubuntu 24.04 ARM64, managed via AWS Systems Manager (SSM) and atomic symlink switches with automated health-check rollback.
- **Frontend SPA**: Deployed to **AWS S3** with cache-optimized headers and edge cache invalidation via **Amazon CloudFront**.
- **Security**: Keyless authentication via **AWS IAM OIDC** (no static credentials in GitHub Secrets).

```text
[Developer Push / PR] ──► [GitHub Actions CI (Lint, Test, Build)]
                                    │
                         (Merged to main branch)
                                    │
                                    ├──► [Backend CD] ──► Assume IAM via OIDC
                                    │                     Upload tarball to S3 transit
                                    │                     Run SSM Command on EC2:
                                    │                       • Atomic symlink switch
                                    │                       • systemctl restart
                                    │                       • Poll /health (Auto-rollback on fail)
                                    │
                                    └──► [Frontend CD] ──► Assume IAM via OIDC
                                                          S3 Sync (assets 1y immutable / index.html no-cache)
                                                          CloudFront invalidation (/*)
```

---

## 2. Production-Ready Design Decisions

1. **Keyless AWS OIDC Authentication**: Eliminates static `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. Workflows request short-lived IAM credentials using GitHub's OpenID Connect token (`id-token: write`).
2. **Quality Gates on Pull Requests**: PRs must pass linting and unit tests before merging; broken code cannot reach production.
3. **Zero-Downtime Atomic Rollouts with Auto-Rollback**:
   - Releases are extracted to timestamped directories (`/var/www/backend/releases/<timestamp>`).
   - The current active pointer is switched atomically via symlink (`ln -sfn ... current`).
   - An automated verification loop polls `http://localhost:3000/health`. If it fails within 30 seconds, the previous symlink is restored and systemd is restarted.
4. **Cache Header Optimization**:
   - Fingerprinted JS/CSS chunks (`/assets/*`) are served with `Cache-Control: public, max-age=31536000, immutable`.
   - Entry point (`index.html`) is served with `Cache-Control: no-cache, no-store, must-revalidate` so users receive updates immediately.
   - CloudFront cache invalidation (`/*`) runs upon S3 upload completion.

---

## 3. Assumptions & Rationale

- **AWS Graviton5 (`c9g`) Instance Architecture**: Deploying to ARM64-native Graviton5 instances maximizes performance-per-watt and cuts EC2 hourly compute costs by up to 25–35% compared to legacy x86 instances.
- **AWS Systems Manager (SSM) instead of SSH**: Eliminates the need to open inbound port 22 or manage SSH bastion keys.
- **Systemd Process Supervision**: Provides restart on failure (`Restart=always`), sandboxed execution, and integrated log capture via journald.
- **CloudFront in Front of S3**: S3 static website hosting lacks HTTPS custom domain support and edge caching; CloudFront handles TLS termination and CDN caching.
- **Path-Filtered Workflow Triggers (`paths: [...]`)**: Prevents frontend commits from triggering backend deployments and vice versa.

---

## 4. Pipeline Execution Summary

### Backend (`.github/workflows/backend-ci-cd.yml`)
1. **CI**: Triggers on PR/push touching `backend/**` or `scripts/**`. Installs Bun via `oven-sh/setup-bun@v2`, runs `bun run lint` and `bun test`, then bundles artifact into `backend-<sha>.tar.gz`.
2. **CD**: Merged to `main` / `master` -> Assumes IAM role via OIDC -> Uploads tarball to S3 transit -> Sends SSM RunShellScript command to EC2 instance -> Runs `scripts/deploy-backend.sh` (extracts release, updates symlink, restarts systemd service with Bun, verifies health check, retains last 5 releases).

### Frontend (`.github/workflows/frontend-ci-cd.yml`)
1. **CI**: Triggers on PR/push touching `frontend/**`. Installs Bun via `oven-sh/setup-bun@v2`, runs `bun run lint`, `bun test`, and `bun run build` into `dist/`.
2. **CD**: Merged to `main` / `master` -> Assumes IAM role via OIDC -> Syncs `dist/assets/` with 1-year cache -> Syncs `dist/index.html` with `no-cache` -> Triggers CloudFront invalidation.

---

## 5. Deliberate Omissions & Trade-offs

- **Blue/Green ASG Deployments**: Replaced with in-place atomic symlink releases. Saves substantial infrastructure costs for single/small instance clusters while still providing zero downtime and instant rollback.
- **Multi-Region Deployments**: Single region (`us-east-1`) avoids cross-region DNS failover complexity and data replication costs.
- **Heavy End-to-End Browser Tests**: Kept CI pipeline execution under 2 minutes for fast developer feedback. E2E tests can be added as a staging gate.
