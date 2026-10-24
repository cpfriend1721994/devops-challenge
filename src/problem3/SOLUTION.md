# Problem 3: Debugging Issues Within System

## Overview

Operational debugging runbook for the two-tier application stack in **Problem 4**:
- **Backend**: Bun HTTP API on **AWS EC2 (Graviton5 `c9g.large` / `c9g.xlarge`)** managed via `systemd`.
- **Frontend**: Static SPA hosted on **AWS S3** and distributed via **Amazon CloudFront**.
- **Delivery**: GitHub Actions CI/CD.

---

## 1. CI Pipeline Failures

### 1.1 Dependency Lockfile Out of Sync
- **Symptom**: `bun install --frozen-lockfile` fails due to lockfile mismatch with `package.json`.
- **Diagnosis**: A package was installed or updated without committing `bun.lockb` / `bun.lock`.
- **Resolution**:
  ```bash
  bun install
  git add package.json bun.lock*
  git commit -m "fix(deps): sync bun lockfile"
  ```

### 1.2 Security Audit Gating
- **Symptom**: CI step `bun audit` or security scanner exits with non-zero code.
- **Resolution**:
  ```bash
  bun audit || npm audit
  bun update
  ```

---

## 2. CD Deployment Failures

### 2.1 AWS OIDC Token Rejection (`AssumeRoleWithWebIdentity`)
- **Symptom**: `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
- **Root Cause**: IAM Role Trust Policy mismatch with GitHub repository name, branch (`refs/heads/main`), or missing audience `sts.amazonaws.com`.
- **Fix**: Verify IAM Trust Policy allows the GitHub OIDC provider:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<ORG>/<REPO>:ref:refs/heads/main" }
      }
    }]
  }
  ```

### 2.2 EC2 Deployment Script Failure & Rollback
- **Symptom**: Deployment step fails during post-install health check.
- **Diagnosis**: The deployment script (`scripts/deploy-backend.sh`) polls `http://localhost:3000/health` up to 10 times. If the process fails on startup, the script automatically reverts the symlink (`/var/www/backend/current`) to the previous release and restarts `systemd`.

---

## 3. EC2 Backend Runtime Debugging

### 3.1 HTTP 502 Bad Gateway / 504 Timeout
- **Step 1: Check Systemd Service Status**:
  ```bash
  systemctl status backend-api.service
  ```
- **Step 2: Inspect Live Application Logs**:
  ```bash
  journalctl -u backend-api.service -n 100 --no-pager -f
  ```
- **Step 3: Verify Listening Ports**:
  ```bash
  ss -tulpn | grep 3000
  # If another PID holds the port:
  lsof -i :3000
  ```
- **Step 4: Check for Out-Of-Memory (OOM) Killer**:
  ```bash
  dmesg -T | grep -i -E "oom|killed process"
  ```
  *Remedy*: Scale the EC2 instance to a higher-capacity AWS Graviton5 instance (`c9g.xlarge` or `c9g.2xlarge`) or optimize Bun worker memory footprints.

---

## 4. S3 & CloudFront Frontend Debugging

### 4.1 SPA Deep-Link 403 / 404 on Refresh
- **Symptom**: Navigating to `https://app.domain.com/` works, but refreshing `https://app.domain.com/orders/123` returns an S3 XML `403 Forbidden` or `404 Not Found`.
- **Root Cause**: S3 is an object store without a file at path `/orders/123`.
- **Resolution**: In **CloudFront Custom Error Responses**, route error codes `403` and `404` to `/index.html` with HTTP Response Code `200` and Error Caching Min TTL `0s`.

### 4.2 Stale Code / Cache Invalidation
- **Symptom**: Deploy finishes but users still see old bundle versions.
- **Root Cause**: `index.html` was cached with a long TTL, or CloudFront invalidation was skipped.
- **Resolution**:
  - Enforce `no-cache` on `index.html`:
    ```bash
    aws s3 cp dist/index.html s3://<BUCKET>/index.html \
      --cache-control "no-cache, no-store, must-revalidate" --metadata-directive REPLACE
    ```
  - Fingerprinted JS/CSS assets can cache for 1 year:
    ```bash
    aws s3 sync dist/assets s3://<BUCKET>/assets \
      --cache-control "public, max-age=31536000, immutable"
    ```
  - Trigger edge invalidation:
    ```bash
    aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/*"
    ```

### 4.3 Cross-Origin Resource Sharing (CORS) Block
- **Symptom**: Browser console logs `blocked by CORS policy`.
- **Resolution**: Ensure the backend returns proper headers and handles `OPTIONS` preflight with `204 No Content`:
  ```javascript
  res.setHeader('Access-Control-Allow-Origin', 'https://app.domain.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  ```

---

## 5. Incident Response Timeline

1. **0 – 5 min**: Verify health endpoints and alerts (`curl -Iv https://api.domain.com/health`).
2. **5 – 15 min**: Check service status on EC2 (`systemctl status backend-api` and `journalctl -u backend-api -n 50`).
3. **15 – 30 min**: If unresolved, trigger rollback to the previous stable release (`./deploy-backend.sh --rollback`).
4. **Post-Incident**: Root Cause Analysis (RCA) and add a regression test in CI to prevent recurrence.
