# AWS ARM64 sandbox pilot

This root module wraps the MIT-licensed [upstream v8.1.1 release](https://github.com/github-aws-runners/terraform-aws-github-runner/releases/tag/v8.1.1). It targets a dedicated private GitHub sandbox repository and provisions at most one On-Demand `m7g.large` runner. The upstream cleanup pass and other control-plane services can still incur charges at zero workers.

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

Before any apply, get approval for the AWS account, region, budget, existing VPC and private subnets with outbound connectivity, and dedicated GitHub App installation. Use the [upstream setup guide](https://github-aws-runners.github.io/terraform-aws-github-runner/getting-started/) for App permissions and webhook setup. Pass the existing SSM parameter ARNs and names for the App ID, base64-encoded private key and webhook secret. Keep parameter values outside Terraform. Use an approved state backend before a live plan or apply and include existing network costs in the budget, especially if outbound access requires a NAT gateway.

Copy the manual smoke workflow to the approved private sandbox repository. Install the App only for that repository and point it at the `webhook_endpoint` stack output. Review the plan, then, once authorized, verify an unrelated label or repository doesn't launch a worker and dispatch the matching smoke job. Record startup time, job outcome, instance and disk deletion, and residual costs. The smoke workflow in the public product repository is a template for the pilot. Review the pilot result before enabling access to real customer workflows.
