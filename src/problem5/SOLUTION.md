# Problem 5: Fortify The Castle

## 1. Security Architecture Overview

Defense-in-depth model built on **Zero Trust** and **Least Privilege** across every layer of the crypto trading platform:

```text
[Clients / Traders]
       │
       ▼ (DDoS & Web Exploit Filtering)
[AWS Route 53 (DNSSEC) + AWS WAF + AWS Shield Advanced]
       │
       ▼ (TLS 1.3 Strict Ciphers / Anycast)
[AWS Global Accelerator + Application Load Balancer]
       │
       ▼ (Private VPC - No Public IPs)
[EKS Workloads (Istio Service Mesh with Strict mTLS - Graviton5 c9g)]
       ├── Order & Auth APIs (Non-root, read-only rootfs)
       ├── Matching Engine (Isolated c9g.4xlarge Node Group)
       └── Withdrawal Service ──► [AWS Nitro Enclave on Graviton5]
                                    • Hardware cryptographic signing
                                    • Isolated CPU/RAM, zero network ingress
       │
       ▼ (Encrypted in transit & at rest via AWS KMS CMK)
[Isolated Database Tier (No Internet Access)]
       ├── Aurora PostgreSQL 17 (db.r8g / db.r9g, auto-rotated secrets, double-entry checks)
       ├── ElastiCache Redis / Valkey (cache.r8g / cache.r9g, TLS + AUTH enabled)
       └── Amazon MSK Kafka 3.8+ (kafka.m8g, mTLS + SCRAM-SHA-512)

[Governance & Telemetry]: GuardDuty (ML Threat Detection) + CloudTrail (WORM Object Lock)
```

---

## 2. Security Controls & Threat Mitigation

### Perimeter & Edge
- **AWS WAF & Shield Advanced**: Mitigates DDoS, rate-limits abusive IPs (max 200 req/min), and filters SQLi, XSS, and malicious bots before traffic reaches compute.
- **Route 53 DNSSEC & TLS 1.3**: Prevents DNS spoofing and ensures forward secrecy with modern cipher suites.

### Network Isolation
- **Strict 3-Tier VPC Subnetting**: Database instances (Aurora, Redis, MSK) reside in fully isolated subnets with no internet gateway or NAT route. Ingress is restricted via Security Groups to specific EKS pod CIDRs.
- **VPC Flow Logs & AWS GuardDuty**: Continuously monitors traffic flows for anomalous DNS queries, port scans, and communication with known malicious IPs.

### Compute & Containers
- **Istio Service Mesh (Strict mTLS)**: Encrypts all internal pod-to-pod communications with TLS 1.3 and validates identities via short-lived X.509 certificates.
- **Hardened Pod Security**: Enforces `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, and drops all Linux capabilities. ECR images are scanned automatically by Amazon Inspector for CVEs.

### Identity & Secrets
- **IAM Roles for Service Accounts (IRSA)**: Pods obtain temporary, short-lived AWS credentials via OIDC. No static AWS access keys exist in containers.
- **AWS Secrets Manager Auto-Rotation**: Database credentials rotate automatically every 30 days without application downtime. Secrets are encrypted using a KMS Customer Managed Key (CMK).

### Cryptographic Custody
- **AWS Nitro Enclaves on Graviton5**: Blockchain signing keys never touch regular host memory. Signing runs inside an isolated hardware enclave on the AWS Nitro System with zero network access and no persistent storage, utilizing CPU hardware-rooted cryptographic attestation.

### Audit & Compliance
- **Tamper-Proof Audit Logging**: CloudTrail logs are written to an S3 bucket with **Object Lock (WORM - Write Once, Read Many)** to prevent alteration or deletion by compromised admin accounts.

---

## 3. Implementation Prioritization

### P0: Refuse to Ship Without (Critical Launch Blockers)
1. **Network Isolation**: Complete isolation of the database tier with zero public IPs on backend worker nodes.
2. **KMS Encryption**: Customer Managed Keys (CMK) enforcing encryption at rest across EBS, Aurora, MSK, and S3.
3. **IRSA (Least Privilege)**: Zero long-lived AWS credentials in configuration files or container environment variables.
4. **Nitro Enclaves & Withdrawal Velocity Limits**: Hardware-isolated key signing and rate caps on hourly automated withdrawals.
5. **Double-Entry Ledger Integrity**: Database constraints preventing negative account balances and unbalanced ledger journals.

### P1: Prioritize Soon (Within 60 Days)
1. **Istio mTLS Service Mesh**: Pod-to-pod mutual encryption and zero-trust identity verification.
2. **Automated Secrets Rotation**: 30-day credential rotation via Secrets Manager.
3. **Automated CI/CD Vulnerability Gates**: Block container deployments failing CVE severity thresholds.

### P2: Defer (Post-Scale Enhancements)
1. **Dedicated CloudHSM**: AWS KMS + Nitro Enclaves fulfill regulatory security requirements at a fraction of CloudHSM's operational and financial cost.
2. **Third-Party SIEM Integration**: Native AWS GuardDuty, Security Hub, and CloudWatch provide adequate coverage for initial launch.

---

## 4. Deliberately Left Out & Accepted Trade-offs

- **Dedicated CloudHSM vs. KMS + Nitro Enclaves on Graviton5**: Chose KMS and Nitro Enclaves running on latest Nitro-based Graviton5 compute instances to avoid the high baseline cost and complex manual cluster management of CloudHSM while still achieving cryptographic hardware isolation and FIPS 140-3 compliance.
- **Deep Packet Inspection (DPI) Next-Gen Firewall**: Relied on AWS WAF, Security Groups, and VPC Network ACLs. Inline DPI appliances introduce 10–30ms of network latency per hop, violating the **p99 < 100ms** SLA.
- **Service Mesh Latency Overhead**: Accepted ~0.5ms latency penalty for pod-to-pod mTLS in exchange for Zero-Trust compliance; mitigated by HTTP/2 connection pooling.

---

## 5. Working Assumptions & Required Facts

- **Regulatory Jurisdiction**: Assumed adherence to international financial standards (SOC 2 Type II, ISO 27001). Will confirm specific regional requirements (e.g. MAS, MiCA, FinCEN) with Legal.
- **Custody Architecture**: Assumed a 95/5 rule (95% of digital assets in offline cold storage, 5% in the automated hot wallet managed via Nitro Enclaves). Will align with institutional custody partners.
- **KYC / AML Integration**: Assumed identity verification is handled asynchronously by third-party providers (e.g. Sumsub, Chainalysis) off the critical order-execution path.
