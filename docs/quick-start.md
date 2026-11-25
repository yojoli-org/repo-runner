# Easy start

Run a GitHub Actions job on an on-demand runner in your AWS account. Start with one private test repository and one Linux ARM64 worker. The worker starts when a matching job queues and is removed after the job.

## Try the pilot today

Run the guided installer on a machine with Node.js 22.18 or later, AWS CLI, GitHub CLI, and Terraform 1.10 or later. Sign in to AWS and GitHub first. Use an organization-owned private test repository with the [pilot smoke workflow](../.github/workflows/pilot-smoke.yml) merged to its default branch. The AWS operator needs permission to deploy the sandbox stack and to read and write the installation's three App parameters.

1. Copy [the example settings](customer-install.example.json) outside the checkout. Set the AWS account, region, profile, existing VPC and public subnets, a private state bucket and unique state key, and the GitHub test repository. Choose an unused prefix and App name. Keep the bucket and key dedicated to this setup. For an isolated smoke test in an account with a Lambda concurrency quota of 10 or lower, set `"concurrency": "shared"`.
2. From the Repo Runner checkout, run:

   ```bash
   npm ci
   node onboarding/install-customer.mjs --config /path/to/customer-install.json
   ```

3. Review and approve the AWS plan at the prompt. Open the local link it prints and approve the GitHub App. Once the installer confirms credentials were saved, install the App on only the test repository and return to the terminal to continue.
4. The installer verifies the App's repository scope, dispatches the smoke job, and verifies that AWS removed the worker and its boot disk and GitHub removed the runner registration. The control plane stays deployed and can incur idle costs.

Keep the private workspace path printed by the installer. If interrupted after workspace preparation, run the same command with `--resume /path/to/installation-workspace`. If GitHub created the App but credential storage failed, inspect the App and parameter metadata before retrying. The [operator guide](pilots/operator-guide.md) covers prerequisites, troubleshooting, and teardown. For teardown, use the workspace's `pilot` directory and the same AWS and state settings.

## What the portal will do

The goal is to let you choose how much help you want. Connect the accounts you want to use, select repositories and a runner pool, review the changes, and approve the steps you want Repo Runner to perform. The portal will show setup progress and the test result. You can keep steps such as deployment or workflow edits under your own control.

GitHub Actions and AWS are the first supported combination for this design. See the [portal plan](plan.md#portal-onboarding) for how other platforms could fit later.
