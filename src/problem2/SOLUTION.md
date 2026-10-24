# Problem 2: Diagnose Me Doctor

## Scenario Summary
- **Host**: Cloud-hosted Ubuntu 24.04 LTS VM on **AWS Graviton5 (`c9g.large`)** (64 GB NVMe EBS `gp3` storage).
- **Service**: Dedicated solely to **NGINX** (reverse proxy / load balancer).
- **Alert**: Storage pinned at **99% utilization**.

---

## 1. Diagnostic Runbook

Execute these triage steps sequentially via SSH:

### Step 1: Check Disk & Inode Capacity
```bash
# Verify block storage per mount point
df -hT

# Check inode usage (100% inode exhaustion prevents file creation even with free GBs)
df -i
```

### Step 2: Check for Unlinked "Ghost" Files Held by NGINX
If an active log was deleted via `rm`, Linux retains the disk allocation until all processes holding the open file descriptor close it:
```bash
# List open files that have been deleted but still hold disk blocks
lsof +L1
# Or filter specifically for NGINX:
lsof | grep -i "(deleted)" | grep nginx
```
*Symptom*: `df -h` reports 99% used, while `du -sh /` reports only a few GBs.

### Step 3: Identify Top Disk Consumers
```bash
# Scan /var without traversing cross-filesystem mount points (-x)
du -ahx /var | sort -rh | head -n 20

# Inspect NGINX directories directly
ls -lhS /var/log/nginx/
ls -lhS /var/cache/nginx/
ls -lhS /var/lib/nginx/
```

### Step 4: Check Systemd Journal and Core Dumps
```bash
# Check journald disk footprint
journalctl --disk-usage

# Check for crash dumps
ls -lh /var/lib/systemd/coredump/ /var/crash/
```

---

## 2. Root Causes, Impact & Recovery

### Scenario 1: Unrotated / Massive NGINX Logs
- **Cause**: `/etc/logrotate.d/nginx` is disabled, failing, or upstream errors (502/504) flooded access/error logs with gigabytes of data.
- **Impact**: Disk reaches 100%; NGINX fails to write logs; system operations and monitoring fail (`No space left on device`).
- **Immediate Relief**: Truncate active log files in place (never `rm` directly):
  ```bash
  truncate -s 0 /var/log/nginx/access.log
  truncate -s 0 /var/log/nginx/error.log
  rm -f /var/log/nginx/*.gz /var/log/nginx/*.1
  ```
- **Permanent Fix**: Verify `/etc/logrotate.d/nginx` configuration:
  ```text
  /var/log/nginx/*.log {
      daily
      missingok
      rotate 7
      compress
      delaycompress
      notifempty
      create 0640 www-data adm
      sharedscripts
      postrotate
          invoke-rc.d nginx rotate >/dev/null 2>&1
      endscript
  }
  ```
  Test dry run: `logrotate -d /etc/logrotate.d/nginx`.

---

### Scenario 2: Unlinked Deleted Logs Held Open by NGINX Workers
- **Cause**: An operator ran `rm /var/log/nginx/access.log` to free disk. The file is unlinked from the directory tree, but NGINX worker PIDs hold open file descriptors.
- **Impact**: Disk space remains allocated at 99% despite files being invisible in `ls`.
- **Immediate Recovery**:
  ```bash
  # Tell NGINX to reopen log handles without dropping active connections
  nginx -s reopen
  # Or reload the service:
  systemctl reload nginx
  ```
  Verify release: `df -h` immediately reflects freed space.

---

### Scenario 3: NGINX Proxy Cache & Client Body Buffer Saturation
- **Cause**: `proxy_cache_path` lacks a `max_size` cap, or client request buffering (`client_body_temp_path`) spooled large uploads to `/var/cache/nginx/` or `/var/lib/nginx/body/`.
- **Impact**: Upstream writes fail with `HTTP 500` (`write() failed (28: No space left on device)`).
- **Immediate Relief**:
  ```bash
  rm -rf /var/cache/nginx/proxy_temp/* /var/lib/nginx/body/*
  ```
- **Permanent Fix**: Enforce strict caps in `/etc/nginx/nginx.conf`:
  ```nginx
  proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=app_cache:50m max_size=10g inactive=12h use_temp_path=off;
  client_max_body_size 10M;
  client_body_buffer_size 128k;
  proxy_buffer_size 128k;
  proxy_buffers 4 256k;
  ```
  Test and apply: `nginx -t && systemctl reload nginx`.

---

### Scenario 4: Systemd Journal & Core Dump Saturation
- **Cause**: `systemd-journald` default storage limit consumed excessive space, or recurring service crashes generated multi-gigabyte coredumps in `/var/lib/systemd/coredump/`.
- **Immediate Relief**:
  ```bash
  journalctl --vacuum-size=500M --vacuum-time=2d
  rm -rf /var/lib/systemd/coredump/*
  ```
- **Permanent Fix**: Set strict limits in `/etc/systemd/journald.conf`:
  ```ini
  [Journal]
  SystemMaxUse=1G
  SystemMaxFileSize=100M
  MaxRetentionSec=1month
  ```
  Apply: `systemctl restart systemd-journald`.

---

## 3. Preventive Architecture & Hardening

- **Dedicated Filesystem Partitions (EBS gp3)**: Mount `/var/log` and `/var/cache` on separate EBS `gp3` volumes (or LVM logical volumes) so log growth cannot saturate the root filesystem (`/`) or lock out SSH.
- **Centralized Log Offloading**: Install AWS CloudWatch Agent, Vector, or Fluent Bit to stream logs to S3/CloudWatch, retaining a maximum of 24–48 hours of logs locally.
- **Proactive Prometheus Alerting**: Alert at 80% warning and 90% critical. Add predictive disk-exhaustion alerts (`predict_linear(node_filesystem_free_bytes[1h], 4 * 3600) < 0`).
- **Emergency Clean-up Watchdog**: Deploy a simple hourly cron check that truncates `.log.1` or cleans temp buffers if `/var` exceeds 90%.
