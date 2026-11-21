# Repo Runner sandbox operator guide

Use this guide to install one disposable Linux ARM64 GitHub Actions runner in an AWS sandbox and verify that it returns to zero after a job. The test uses a dedicated private repository and needs no access to customer source. A clean second installation is still pending.

## 1. Prepare GitHub and AWS

- Have a GitHub organization owner designate a private pilot repository and merge the [manual smoke workflow](../../.github/workflows/pilot-smoke.yml) into its default branch. Use the label `repo-runner-pilot` and keep the test manual.
- Approve the AWS account, region, pilot spending target, and operator access. Use a named AWS CLI profile. Record the intended account ID and compare it with `aws sts get-caller-identity --profile "$AWS_PROFILE"` before planning or deploying.
- Select existing public subnets in the same VPC with an active internet gateway route. Verify that the sandbox can launch `t4g.small` in at least one selected zone. The worker uses a temporary public IPv4 address and a security group with no inbound rules. It needs no NAT gateway. The control plane, storage, and logs can still generate usage between jobs.
- Prepare a dedicated S3 state bucket with public access blocked, server-side encryption, and versioning. Limit access to operators and enable Terraform S3 locking. Record the bucket and state key so another operator can resume the work.

## 2. Create the pilot GitHub App

Have the organization owner create an organization-owned App and limit its installation to the private pilot repository. Leave the webhook inactive until AWS provides the URL. For repository-scoped runners, set repository **Actions**, **Checks**, and **Metadata** to read-only and **Administration** to read/write. Leave organization permissions unset. Use a separate App for another installation. [Upstream GitHub App setup](https://github-aws-runners.github.io/terraform-aws-github-runner/getting-started/)

Have the operator generate the App private key and a separate random webhook secret, then store these parameters in AWS Systems Manager in the same account and region as the stack:

| Parameter example | Type | Value |
| --- | --- | --- |
| `/repo-runner/pilot/app-id` | `String` | Numeric GitHub App ID |
| `/repo-runner/pilot/app-key-base64` | `SecureString` | Base64-encoded contents of the App PEM file |
| `/repo-runner/pilot/webhook-secret` | `SecureString` | Random secret shared with this App's webhook |

Supply only parameter names and ARNs to Terraform. Keep parameter values, PEM files, saved plans, and state in restricted storage outside Git. Verify parameter names and types using metadata only.

## 3. Review and deploy

1. Check out a reviewed Repo Runner commit. Follow [the Terraform pilot README](../../infra/pilot/README.md) to download and verify the pinned Lambda archives. Use Terraform 1.10 or later and the committed provider lockfile.
2. In `infra/pilot`, prepare an untracked variable file using [the example](../../infra/pilot/terraform.tfvars.example). Set the approved region and account, VPC, subnets, private pilot repository, and SSM parameter references. Initialize against the approved S3 bucket and state key as described in the Terraform README.
3. Run `terraform plan -input=false -out=pilot.tfplan` in a restricted working directory. Review the target account, repository scope, worker IAM, no-inbound security group, temporary public IP, worker cap of one, and expected idle resources. Verify the plan includes no running EC2 instance. Investigate unexpected changes before continuing.
4. With explicit approval, apply the reviewed plan with `terraform apply -input=false pilot.tfplan`. Read the endpoint with `terraform output -raw webhook_endpoint`.
5. In the GitHub App settings, enable the webhook, enter the endpoint and the same secret stored in Parameter Store, leave SSL verification enabled, and subscribe to **Workflow job**. Verify the installation still names only the pilot repo.

## 4. Prove the runner works

1. Confirm there are zero active pilot workers and no queued pilot jobs before dispatch. Run **Pilot runner smoke test** manually from the private repository's default branch.
2. Follow the job in GitHub and record the EC2 instance and boot-volume IDs while the worker exists. Confirm only one ARM64 worker launches and the workflow passes.
3. Verify the instance reaches `terminated`, its boot volume disappears, and the GitHub runner registration is removed. Record dispatch-to-start time, job duration, cleanup time, and any unexpected costs or manual steps.
4. If the job stays queued, check GitHub App delivery, then the AWS webhook, dispatcher, and scale-up logs in that order. A successfully received event can still be blocked by label matching, instance eligibility, or launch failure. Cancel a stalled test before retrying and check for leftover workers. Review logs without exposing credentials.

## 5. Pause or tear down

- **Pause:** Disable the GitHub App webhook, confirm the queue is drained and workers and disks are gone. Scheduled AWS tasks and storage remain provisioned. Re-enable the webhook when ready to resume.
- **Remove the stack:** Disable the webhook, let active jobs finish or cancel them explicitly, and verify worker cleanup. Plan with `terraform plan -destroy -input=false -out=pilot-destroy.tfplan`, using the same backend, inputs, and account. Review the exact deletions and obtain approval before applying the saved destroy plan. Verify stack resources are gone. If a nonempty versioned bucket blocks teardown, review its contents and retention requirements before asking for deletion approval.
- **Retire external setup:** The state bucket, SSM inputs, GitHub App, and private repository were created outside the stack. Decide which to retain. For permanent retirement, have the operator revoke the App key and remove the installation and secret parameters. Archive state securely or remove it under the approved retention policy.

For the next rehearsal, have a second operator use a clean sandbox and this guide. Measure time from prerequisites ready to first passing job, log each point where the operator needed help, and verify teardown independently.
