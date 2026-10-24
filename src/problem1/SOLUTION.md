# Problem 1: Building Castle In The Cloud

## 1. System Architecture Overview

Scalable, highly available crypto trading platform designed on AWS to achieve **500 rps** throughput and **p99 latency < 100ms** for order placement and market data streams.

```text
[Clients / Web / Mobile / API Traders]
       │
       ▼ (DNS / Latency Routing)
[Amazon Route 53 + AWS Global Accelerator]
       │
       ▼ (Anycast TLS 1.3 Termination)
[Application Load Balancer (ALB)]
       │
       ├── /api/v1/order ──────► [Order Gateway API (EKS Graviton5 c9g - Multi-AZ)]
       ├── /api/v1/user  ──────► [Auth & User Service (EKS Graviton5 c9g)]
       └── /ws/*         ──────► [WebSocket Gateway (EKS Graviton5 c9g)]
                                       │
       ┌───────────────────────────────┴───────────────────────────────┐
       ▼                                                               ▼
[Pre-Trade Risk Engine]                                     [ElastiCache Redis / Valkey]
       │ (Atomic Balance Check)                                    • Sub-ms cache on cache.r8g / r9g
       ▼ (Ordered Append)                                          • Real-time L2 orderbook
[Amazon MSK (Apache Kafka 3.8+ on kafka.m8g)] ◄─── (Market ticks) ─────┤
       │ (Partitioned by Symbol)                                       │
       ▼ (Sequential Deterministic Feed)                               │
[Order Matching Engine (c9g Dedicated Cores - Active / Standby)]       │
       │ (Trade Execution Events)                                      │
       ▼                                                               │
[Settlement & Ledger Worker] ──────────────────────────────────────────┘
       │
       ├──► [Amazon Aurora PostgreSQL 17] (ACID Double-Entry Ledger on db.r8g / db.r9g, Multi-AZ)
       └──► [Amazon S3] (Historical ticks & cold audit logs)
```

---

## 2. Cloud Services & Alternatives Analysis

- **Amazon EKS (Kubernetes)**: Microservice orchestration across 3 AZs with Karpenter dynamic node provisioning on **AWS Graviton5 (`c9g`)** compute-optimized instances with Pod Topology Spread Constraints.
  - *Alternatives rejected*: **Amazon ECS** (limited pod-level scheduling, core pinning, and networking control); **Raw EC2** (excessive operational overhead for rolling deploys and self-healing).
- **AWS Global Accelerator**: Anycast IP routing directly to AWS global private backbone, bypassing public internet hops to keep p99 < 100ms and maintain stable WebSocket sessions.
  - *Alternatives rejected*: **Standard Public ALB** (vulnerable to ISP routing jitter and packet drops); **CloudFront for API** (extra hop overhead on dynamic WebSocket/POST flows).
- **Amazon MSK (Apache Kafka)**: Central event streaming backbone running on Graviton-based `kafka.m8g` broker instances, providing strict partition ordering per symbol (e.g. `BTC_USDT`) and durable commit logs for deterministic replay.
  - *Alternatives rejected*: **Amazon SQS FIFO** (throughput capped at 3,000 msg/s, no event replay); **RabbitMQ** (lacks native append-only log suited for state reconstruction).
- **Amazon ElastiCache (Redis / Valkey)**: In-memory balance validation and orderbook snapshots on memory-optimized Graviton `cache.r8g` / `cache.r9g` instances with sub-millisecond response times (<1ms) via atomic Lua scripts.
  - *Alternatives rejected*: **MemoryDB for Redis** (3–8x higher write latency due to multi-AZ synchronous transaction logs); **Memcached** (no complex data structures like Sorted Sets).
- **Amazon Aurora PostgreSQL 17**: Authoritative ACID ledger for financial double-entry bookkeeping deployed on `db.r8g` / `db.r9g` Graviton instances across 3 AZs with automated failover (<30s) and NVMe-optimized storage.
  - *Alternatives rejected*: **DynamoDB** (complex and error-prone for relational double-entry financial ledgering); **Self-managed PostgreSQL on EC2** (high operational burden for failover and PITR).
- **Amazon S3**: High-durability (11 9's) repository for compressed market ticks and compliance archives with automatic lifecycle transitions.

---

## 3. High Availability & Fault Tolerance

- **Multi-AZ Redundancy**:
  - EKS worker nodes evenly spread across 3 AZs (`c9g.xlarge` / `c9g.2xlarge`).
  - Aurora deployed with 1 Primary and 2 Read Replicas on `db.r8g` / `db.r9g` across different AZs.
  - MSK runs with 3 brokers across 3 AZs (`min.insync.replicas=2`).
- **Active-Standby Deterministic Matching Engine**:
  - Runs in Active-Standby pairs per trading symbol on dedicated Graviton5 instances. Both consume the identical Kafka partition feed to maintain synced in-memory state.
  - If the active node crashes, the standby assumes the primary role immediately with zero state loss and zero desync.
- **Backpressure & Overload Protection**:
  - Token-bucket rate limiting at ALB/WAF per API key and client IP.
  - Kafka decouples ingestion from persistence: database write spikes do not cascade into HTTP 504 timeouts at the order gateway.

---

## 4. Cost Optimization Strategy

- **Next-Gen AWS Graviton5 (`c9g`) Compute**: Deploy EKS node groups on AWS Graviton5 compute-optimized instances (`c9g.xlarge` / `c9g.2xlarge`), delivering **up to 30–40% better compute performance** and higher energy efficiency per transaction compared to older x86/Graviton architectures.
- **Capacity Planning**:
  - Baseline capacity (Matching Engine, MSK, Aurora) covered by 1-year or 3-year **Savings Plans / Reserved Instances** (up to 60% savings).
  - Stateless API and WebSocket pods scale dynamically on Karpenter with Spot/On-Demand mixed pools on `c9g` instances.
- **Storage Lifecycle**: Archive tick logs to S3 Glacier Instant Retrieval after 30 days, cutting storage costs by >70%.

---

## 5. Scaling Strategy (500 to 10,000+ rps)

1. **Symbol-Based Horizontal Sharding**: Partition Kafka topics and deploy dedicated matching engine pairs per high-volume trading symbol (`BTC_USDT`, `ETH_USDT`) on dedicated `c9g.4xlarge` compute nodes.
2. **Read/Write Segregation**: Aurora Primary handles financial settlement writes; user queries (order history, portfolio balances) read from auto-scaled Aurora Replicas on `db.r8g` / `db.r9g` and Redis.
3. **WebSocket Gateway Fan-out**: Separate connection termination pods from core processing; fan out market depth deltas via Redis Pub/Sub.
4. **Engine Optimization**: Implement matching engines in Rust/C++ utilizing the **LMAX Disruptor pattern** with lock-free ring buffers and Graviton5 CPU core pinning for >50k orders/sec per symbol.
