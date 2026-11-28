# Portal v1 AWS approval and verification contract

This document records the approved direction for [issue #45](https://github.com/yojoli-org/repo-runner/issues/45) in the [Portal v1 milestone](https://github.com/yojoli-org/repo-runner/milestone/1). It names each trust boundary, approval, state owner, and recovery path before implementation starts. It is a design contract, not an authorization: the [implementation plan](plan.md), [operator guide](pilots/operator-guide.md), and `AGENTS.md` still require explicit maintainer approval for cloud applies, IAM changes, paid resources, and GitHub access changes. Exact IAM policies and the launch sequence remain unproven until the AWS sandbox rehearsal described below.

The existing CLI installer remains supported. The guided portal path uses a single CloudFormation approval in the customer’s AWS account to begin provisioning.

## Agreed scope

One customer approval starts provisioning in one selected account and one selected region. A bootstrap stack bound to the installation provisions the destination guard, the customer-side deployment job and its scoped role, dedicated state and logs, status discovery, credential storage, and the runner verifier. The deployment job, not the stack, creates the runner pool from the same pinned Terraform package the installer uses. Portal sign-in, tenant metadata, and onboarding progress stay in Repo Runner's AWS account. GitHub App installation, the smoke run, ongoing management, and uninstall each have their own approval.

v1 is GitHub and AWS only: one private test repository, one starter Linux ARM64 pool, at most one On-Demand worker, zero idle workers, and no CLI or per-customer operator step on the happy path. The `t4g.small`, one-repository, one-pool limits are starter settings, not production defaults.

## Current rehearsal baseline

Only the following are demonstrated today, and only in synthetic or isolated rehearsals:

- The [browser launch proof](../infra/browser-bootstrap/README.md) showed that a customer console approval can create a scoped CodeBuild project, log group, launcher, and service roles and reach a successful build in the customer account. It uses a short-lived presigned template URL.
- The browser-started Terraform preview produces a plan for inspection. The sandbox deployment variant applies a saved plan after rejecting changes to existing resources or planned `aws_instance` creation. It writes encrypted, locked state. Deployment requires a pre-existing `rr-bootstrap-…` role and an existing state bucket; the template does not grant those permissions.
- The combined template fixes the account, region, stack name, VPC, subnets, prefix, boundary, source bucket/key/version, and repository so a wrong destination skips every resource. A successful stack creation confirms dispatch only; `BuildId` must still be traced to the exact build.
- The onboarding protocol, attempt claim, credential writer, deployment-state, and smoke checks have mocked tests. `npm test` covers them.

There is **no live evidence** yet for the cross-account status role, the private unsigned-template fetch, the two-phase launch, the status/build binding against a real deployment, or a clean second installation. The deployment role and runtime boundary outputs are candidate documents that must be reviewed and rehearsed, not attached.

## Proposed two-phase launch boundary

The approved direction splits launch into two phases under the same customer approval, because the deployment role does not exist until the stack creates it:

1. The approved stack creates the destination guard, the dedicated deployment role, the CodeBuild project, and a customer-side launcher that waits. A fixed template records the account, region, stack name, prefix, subnets, source bucket/key/version, expected SHA-256, and repository.
2. The portal proves with read-only evidence that the role belongs to the approved stack and account. It then updates its own artifact bucket policy to allow that exact role and exact object version, and signals readiness to the launcher through an authenticated channel.
3. The launcher starts the one approved project from fixed inputs. Reject a preexisting, replaced, or differently attributed role; reconcile an uncertain start against the same installation and build record; remove abandoned grants.

The direction is approved. The readiness protocol and its exact grants remain subject to rehearsal. Before implementation the rehearsal must prove the authenticated readiness signal, the IAM scope used to verify role ownership, rejection of wrong identities and versions, and a private template fetch from a fresh customer account.

## Trust boundaries and candidate policy scopes

The operations below are the review baseline from the approved draft. Every row is a verification gate: confirm the exact action, resource ARN, condition, and trust policy in the sandbox before treating any row as approved IAM. Wildcards are placeholders for a fixed installation value, not policy text.

| Principal | Owner | Candidate scope | Boundary |
| --- | --- | --- | --- |
| Customer approver and launcher | Customer | `cloudformation:CreateStack`/`DescribeStacks`; `iam:CreateRole`/`AttachRolePolicy`/`PutRolePolicy`/`CreateInstanceProfile`/`AddRoleToInstanceProfile`; `iam:PassRole` to CloudFormation, CodeBuild, and Lambda; `codebuild:StartBuild`/`BatchGetBuilds` on the one project; plus the stack's fixed resources | One named-IAM acknowledgment. Fixed template, no editable parameters. The launcher's build inputs and service role are fixed, and who can start or modify the project is restricted. |
| Deployment job (`rr-bootstrap-<prefix>`) | Customer, created by stack | `s3:GetObjectVersion` on the exact artifact ARN; `s3:ListBucket` on the state prefix; `Get`/`Put` on the exact state and lock keys; `DeleteObject` only on the exact `.tflock`; `logs` write to the exact log group; discovery (`Describe`/`List`) for EC2, Lambda, IAM, API Gateway, SQS, EventBridge, SSM, and KMS; create/update of prefix-scoped pool resources | Trusts only the exact CodeBuild project. IAM changes limited to the pilot role/instance-profile path and require the approved permissions boundary; the job cannot modify the boundary or its own permissions. `PassRole` only to named roles and intended services. No routine delete of state or pool. |
| Registration writer (`rr-registration-<prefix>`) | Customer, created by stack | `ssm:PutParameter` on exactly `app-key-base64`, `webhook-secret`, and `app-id` under the installation path; `kms:Encrypt` through regional SSM with `alias/aws/ssm`; encryption context limited to the two secret parameters. No read. | Portal runtime assumes it with a per-installation external ID for at most 15 minutes. `Overwrite=false`; App ID written last; refuses overwrites. Partial writes require a recovery path before another GitHub exchange. |
| Status reader (`rr-status-<prefix>`) | Customer, created by stack | `cloudformation:DescribeStacks` on the exact stack; `codebuild:BatchGetBuilds` on the exact project; `logs:GetLogEvents` on the exact proof log group and stream | Trusted by the portal runtime with the per-installation external ID. No App credential reads or launch authority. Review resource-level enforcement and any discovery action requiring regional wildcard scope. |
| Runner verifier | Customer, created by stack | Read the App ID and key parameters; decrypt the key through SSM; AWS discovery of the worker, its volumes, and the event-source mapping | Dedicated role. The GitHub App must verify the exact repository scope and receives smoke-dispatch authority only under separate approval. |
| Uninstall | Customer, separate authority | Teardown uses the retained state and exact deployment identity; destruction and state-object deletion are reserved to teardown | Never granted to setup or deployment roles. Order is fixed below. |

`onboarding/portal-aws.mjs` already narrows the writer's assumed session to the exact three parameter ARNs and two-parameter encryption context; `onboarding/parameter-store.mjs` enforces no-overwrite and App-ID-last order. The status bindings in `infra/portal-state/deployment.tf` do **not** yet match a cross-account role: they point at portal-account ARNs and lack `sts:AssumeRole`. That is a blocker, listed under missing evidence.

## Customer choices, decline, and scope

Before **Connect AWS**, preview the exact grants and the target account, region, repositories, infrastructure, capacity, and costs. v1 offers two scopes:

- **Guided.** The customer approves all required grants; the portal performs and verifies the steps.
- **Manual installer.** No portal automation; the existing CLI path in [the easy start](quick-start.md) applies.

If a required grant is declined, do not advance and do not silently widen scope. Record a resumable `blocked_permissions` state that names the missing action, what it enables, and how to resume. Specific fallbacks are gated on rehearsal:

- Status role declined: the portal cannot confirm deployment. Show `deployed — verification manual` and never Runner ready.
- Registration write declined: GitHub registration cannot complete. A customer-hosted credential entry path is an open choice, not a promise.
- Actions write declined: keep the installation deployable and offer a read-only smoke path where the customer dispatches `pilot-smoke.yml` manually and the portal verifies the exact run and AWS cleanup. Runner ready must not claim the portal dispatched the run.

A declined **required** grant blocks the guided scope rather than degrading it.

## Artifact handoff and integrity

The runner artifact is the reviewed deployment bundle: module wrapper, provider lockfile, `artifacts.sha256`, buildspec, `run-plan.sh`, and the pinned Lambda ZIPs. The approved direction is an operator-owned private, versioned, SSE-S3 bucket with Object Lock, read by the exact customer role and object version. The fixed template records the key, version ID, and expected SHA-256; a trusted bootstrap step verifies the digest before executing anything from the bundle, and the job re-verifies the manifest and lockfile. Retries reuse the same version; there is no presigned URL and no URL expiry. Remove the bucket-policy entry on teardown and clean up entries for abandoned installations.

The CloudFormation template is delivered separately from the runner ZIP; its private fetch must be proven from a fresh customer account. Two gaps must close first: `infra/pilot/main.tf` currently sources the module from the public registry at build time, and `artifacts.sha256` covers only the Lambda ZIPs, so the pinned release is not fully integrity-checked. Vendor the v8.1.1 module into the bundle or verify a recorded module checksum. The bucket policy and role identity policy must restrict reads to the approved role and exact object version using the S3 version condition. Rehearse identity binding and verify that a replacement role cannot inherit an old grant through ARN reuse.

## Deployment status, webhook discovery, and smoke proof

**AWS deployment verified.** The portal polls through the status role. Require a completed, accepted stack state and a completed successful CodeBuild run. All of the following must match or the result is `unconfirmed`: installation record, stack account and region, assumed-role account, stack name `rr-<prefix>`, stack ID prefix `arn:aws:cloudformation:<region>:<account>:stack/<stack>/`, `BuildId` beginning `<stack>:` with a UUID, build `projectName` equal to the stack, build `sourceVersion` equal to the pinned bundle version, proof log group `/repo-runner/bootstrap/<stack>`, stream `proof/<uuid>`, and exactly one `webhook_endpoint` line matching `https://<api-id>.execute-api.<region>.amazonaws.com/webhook`. `onboarding/deployment-state.mjs` implements this binding for a build launched by stack creation. For a build launched after stack creation under the two-phase design, an equivalent binding whose identifiers are recorded by the launcher must be defined and rehearsed first.

**GitHub scoped.** After AWS deployment is verified, the portal offers GitHub connection. The App manifest marks the App private and organization-owned, and `verifyInstallationScope` confirms access to exactly the selected private repository using a metadata-only installation token obtained server-side with the App JWT. Repository scope must be confirmed before planning or smoke approval.

**Smoke approval and Runner ready.** Show a distinct approval naming the exact repository, pool, label, one On-Demand ARM64 `t4g.small` worker, zero idle workers, that a VM will launch and incur cost, and the expected categories of cost. Runner ready requires the exact GitHub run URL and ID, a single ARM64 worker, job success, instance termination, deletion of its recorded volumes, and removal of the runner registration. A failed, denied, mismatched, or timed-out check leaves the installation resumable and names the failed check. `onboarding/pilot-smoke.mjs` implements the worker, volume, registration, and single-ARM64 checks; the verifier must produce the equivalent evidence through the approved App and role.

## Transitions, rehydration, retry, and recovery

Portal state is resumable and derived from durable records, not browser memory. The deployment adapter currently returns these AWS-deployment states:

| State | Meaning | Recovery |
| --- | --- | --- |
| `awaiting_approval` | Stack absent or `REVIEW_IN_PROGRESS` | Show the approval link; re-poll before acting. |
| `deploying` | Stack `CREATE_IN_PROGRESS` or build `IN_PROGRESS` | Wait; never start a second build while one is active. |
| `failed` | Stack rollback or build failure | Fix the prerequisite and create a **new** stack name and prefix after a rollback. After a post-apply build failure, run `RR_RECOVERY_PREVIEW=1` against the same state key before any retry. |
| `unconfirmed` | Identity, build, log, or webhook mismatch | Re-poll; inspect the exact build and repository before resetting any claim. |
| `ready` (deployment) | Stack, build, log, and one valid webhook all bound | This means AWS deployment verified only, not Runner ready. |

Beyond deployment, the contract states are `github_scoped`, `smoke_approved`, `runner_ready`, `blocked_permissions`, and `deployed_verification_manual`. Rehydration rules:

- An uncertain `StartBuild` keeps the claim and inspects the build; reset only after checking the build and repository.
- A registration attempt expires after ten minutes and restarts the attempt, not the GitHub App.
- A denied status role surfaces "status access removed" with a re-approval link.
- GitHub sign-in, App creation, credential storage, and smoke approval are separate steps; completing one never marks another complete.
- A portal outage must not affect an already deployed pool: status is read back from AWS, and the pool keeps processing jobs.

## Tenant ownership

Each installation is tenant-scoped. Check the authenticated tenant and approved installation on every read or transition. Repo Runner's portal account owns onboarding metadata and attempts only: tenant and user IDs, organization and App ID, repository, account, region, prefix, stack, source version, state key, step states, and approvals. It does **not** own or store App private keys. The customer owns the AWS account, runner pool, state bucket, SSM parameters, logs, and GitHub App key.

Use tenant-scoped keys, a per-installation external ID, separate prefixes and state keys, and no shared execution roles. v1 allows one repository and one pool per installation and a separate, repository-scoped App per installation.

## Supported account, network, and quota checks

The supported v1 baseline is a commercial AWS account (not GovCloud or China) with active billing and no SCP blocking the listed services, in a region on an explicit allowlist. The pilot region is `us-east-2`; the product allowlist is an open approval item. Required checks:

- A VPC with at least one public subnet in one AZ and an internet-gateway default route; no NAT gateway.
- `t4g.small` capacity in the selected AZ and at least 2 On-Demand vCPU quota.
- At least 1 in-use public IPv4 address quota.
- Regional Lambda concurrency above 10 for the reserved scale-up slot; otherwise a documented `shared` mode that loses scale-up serialization, or a fallback.
- CodeBuild concurrency of at least 1, and available CloudFormation, S3, and SSM limits.
- The regional AWS-managed `alias/aws/ssm` key available for the registration parameters.

An unsupported result must name the failed check and give the fix and a retry: unsupported region or account type, private-subnet-only VPC, missing internet route, insufficient quota, SCP denial, or unavailable `t4g` capacity. Never silently substitute a region, subnets, worker size, or concurrency mode.

## Starter capacity and cost disclosure

Disclose before approval and on the installation page:

- Exactly one On-Demand `t4g.small` (2 vCPU, 2 GiB), zero idle workers, one disposable VM per job, a temporary public IPv4 address, and a security group with no inbound rules.
- Per-job compute, disk, public IPv4, and data transfer.
- Always-on control-plane usage: API Gateway, Lambdas, SQS, EventBridge, CloudWatch 7-day logs, SSM, and state S3.
- Verifier CodeBuild minutes per smoke run.

State plainly that the customer pays AWS directly, that a budget alert does not cap spending, and that the starter pool is for one test repository, not production. No cost figures are recorded yet; publish measured figures before promising amounts.

## Disconnect and uninstall

**Disconnect** revokes portal trust and access and shows what remains. The deployed pool keeps running and processing jobs; the customer can reconnect or continue with the installer.

**Verified uninstall** is a separate, customer-approved authority with a fixed order:

1. Disable webhook delivery, drain or cancel jobs, and verify worker, volume, and runner-registration cleanup.
2. Destroy the pool with the retained state and a saved destroy plan; use `RR_RECOVERY_PREVIEW=1` when a prior apply is uncertain.
3. Only after the pool is gone, delete the bootstrap stack and remove the artifact bucket-policy entry.
4. Delete the SSM parameters and state bucket only on explicit request.

Never delete the bootstrap stack before the pool: that orphans state and the deployment role. Preserve installation metadata until cleanup is verified, and never touch resources outside the installation.

## Open implementation choices

The guided path uses the scoped status reader, the portal’s scoped registration writer, and a customer-side verifier provisioned by the bootstrap stack. Registration credentials transit the portal and are stored in the customer’s SSM parameters. The shared attempt store stays in the portal account. Existing verifier placement is rehearsal infrastructure and must be reconciled with the bootstrap contract.

Review the state bucket choice, supported region allowlist, module-integrity method, private template delivery, measured costs, and the read-only smoke or customer-hosted credential fallback before offering them.

## Missing evidence before authorizing implementation

- Cross-account status role: prove assume-role with the installation external ID and exact customer-account ARNs, and correct `deployment.tf`, which still grants portal-account ARNs.
- Private template delivery: prove CloudFormation can fetch a private template without a presigned URL from a fresh customer account; the browser-bootstrap guide and portal guide currently disagree.
- Cross-account `s3:GetObjectVersion` with exact `aws:PrincipalArn` and `s3:VersionId`, including role creation order, an existing or recreated role, access to other versions, and Object Lock versus teardown.
- The authenticated readiness signal and the launcher's fixed-input start, including launcher success while stack creation fails, duplicate and uncertain launches, and cleanup of abandoned grants.
- Full module integrity: pin or vendor the v8.1.1 module and cover it in the digest.
- `t4g.small`, public-IPv4, Lambda, and CodeBuild quotas in the approved region and AZ.
- The read-only smoke path with a read-only App, plus deny, timeout, mismatch, and cancellation behavior.
- Absent-parameter writes, partial credential writes, and registration rehydration.
- Portal-outage independence of an already deployed pool.
- A clean second installation and verified uninstall in the sandbox, with measured cost figures.

Obtain separate maintainer authorization before any sandbox apply, IAM or GitHub access change, or paid resource. Use the rehearsal results to decide whether the guided path is ready for rollout.
