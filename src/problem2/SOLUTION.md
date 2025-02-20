# An overview diagram of the services used and what role they play in the system
- See SystemDesign.png

# Elaboration on why each cloud service is used and what are the alternatives considered.

- Build Private VPC for applications that public access using ELB for inbound trafic and Nat Gateway for Outbound trafic
- Using AWS Global Accelerator for Global API Trafic, CDN for Global Static trafic
- Using Kubenetes for orchetration to make application resilient to failures, scalable (Self-built or alternatives service like EKS)
- For cost-effective using only 1 Available Zone (us-east-1a) - cheapest AZ on AWS, not necessary to using Multi AZ to prevent Cross-zone Trafic Cost.
- Databases can be Self-built Clusters or alternative solution like RDS, ElastiCache, DocumentDB, ... (But still need Multi AZ and not cost-effective) 

# Plans for scaling when the product grows beyond your current setup.
- When Product Grows, using Kubernetes can help Applications to be scalable. Based on Application Usage & Traffic (That monitored by obesrve tool, logging system) Devops can make a desision for which applications need to scale, which Node Group should be scale, also plan to save cost (prevent not scale unlimited)
