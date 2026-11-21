# AWS ARM64 sandbox pilot

For the complete GitHub and AWS workflow, use the [sandbox operator guide](../../docs/pilots/operator-guide.md).

This root module wraps the MIT-licensed [upstream v8.1.1 release](https://github.com/github-aws-runners/terraform-aws-github-runner/releases/tag/v8.1.1). It targets a dedicated private GitHub sandbox repository and configures a maximum of one On-Demand `t4g.small` runner. Use this 2 GiB starting point for the smoke test and measure representative workloads before choosing a production size. Check account eligibility and potential charges before deployment. The upstream cleanup pass and other control-plane services can still incur charges at zero workers.

From this directory, fetch and verify the pinned deployment assets and validate the configuration locally:

```sh
mkdir -p artifacts
gh release download v8.1.1 --repo github-aws-runners/terraform-aws-github-runner \
  --pattern webhook.zip --pattern runners.zip \
  --pattern runner-binaries-syncer.zip --dir artifacts
shasum -a 256 -c artifacts.sha256
terraform init -backend=false -lockfile=readonly
terraform validate
```

Use existing public subnets with an internet gateway route. Each running worker gets a temporary public IPv4 address for outbound access. The upstream managed runner security group has no inbound rules, and the stack needs no NAT gateway. Confirm the plan attaches only the intended security group. Include public IPv4, compute, disks, and control-plane services when reviewing the pilot spending target. A budget alert does not cap spending.

Before any apply, get approval for the AWS account, region, budget, network, and dedicated GitHub App installation. Use the [upstream setup guide](https://github-aws-runners.github.io/terraform-aws-github-runner/getting-started/) for App permissions and webhook setup. Pass the existing SSM parameter ARNs and names for the App ID, base64-encoded private key and webhook secret. Keep parameter values outside Terraform. Use an approved state backend before a live plan or apply.

For a live plan, initialize against a pre-created, private, encrypted and versioned S3 bucket in the sandbox account. Terraform uses S3 lockfiles, which require Terraform 1.10 or later. Supply the backend configuration separately from the repo:

```sh
AWS_PROFILE=repo-runner-sandbox terraform init -reconfigure -lockfile=readonly \
  -backend-config="bucket=$PILOT_STATE_BUCKET" \
  -backend-config=key=repo-runner/pilot/terraform.tfstate \
  -backend-config="region=$PILOT_AWS_REGION"
```

Copy the manual smoke workflow to the approved private sandbox repository. Install the App only for that repository and point it at the `webhook_endpoint` stack output. Review the plan, then, once authorized, verify an unrelated label or repository doesn't launch a worker and dispatch the matching smoke job. Record startup time, job outcome, instance and disk deletion, and residual costs. The smoke workflow in the public product repository is a template for the pilot. Review the pilot result before enabling access to real customer workflows.
