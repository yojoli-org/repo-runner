# Repo Runner sandbox operator guide

Use this guide to install one disposable Linux ARM64 GitHub Actions runner in an AWS sandbox and verify that it returns to zero after a job. The test uses a dedicated private repository and needs no access to customer source. A clean second installation is still pending.

## 1. Prepare GitHub and AWS

- Have a GitHub organization owner designate a private pilot repository and merge the [manual smoke workflow](../../.github/workflows/pilot-smoke.yml) into its default branch. Use the label `repo-runner-pilot` and keep the test manual.
- Approve the AWS account, region, pilot spending target, and operator access. Use a named AWS CLI profile. Record the intended account ID and compare it with `aws sts get-caller-identity --profile "$AWS_PROFILE"` before planning or deploying.
- Select existing public subnets in the same VPC with an active internet gateway route. Verify that the sandbox can launch `t4g.small` in at least one selected zone. The worker uses a temporary public IPv4 address and a security group with no inbound rules. It needs no NAT gateway. The control plane, storage, and logs can still generate usage between jobs.
- Choose a dedicated S3 state bucket and a unique state key. Keep access limited to operators. The installer creates the bucket after confirmation or verifies an existing bucket's region, ownership, public access block, encryption, and versioning. In `us-east-1`, provide an existing bucket.

## 2. Create the pilot GitHub App

### Customer-side App setup (experimental)

With Node.js 22.18 or later, use this command from the repository root on the same machine as the browser. It uses your signed-in AWS CLI profile to check the target account and write the App credentials directly to your Parameter Store. You need permission to describe parameters and write the three names under the chosen path, including encryption through SSM. A distinct path keeps the rehearsal separate from existing installations.

```bash
node onboarding/customer-app-bootstrap.mjs \
  --profile customer-sandbox --region us-east-2 --account 123456789012 \
  --organization example-org --app-name 'Repo Runner Sandbox' \
  --homepage https://example.com --path /repo-runner/customer-sandbox
```

Open the temporary local link and approve App creation in GitHub. When the command finishes, install the App on the approved private repository only. Use the same parameter path in the Terraform inputs. Enable the webhook after deployment as described below. The loopback callback has synthetic test coverage and still needs a live GitHub rehearsal.

If GitHub creates the App but setup fails, check the App and parameter metadata before retrying. Partial writes may need operator cleanup.

### Manual setup

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
2. In `infra/pilot`, prepare an untracked `terraform.tfvars` using [the example](../../infra/pilot/terraform.tfvars.example). Set the VPC, subnets, a unique resource prefix, the private pilot repository, and the SSM parameter references. In your shell, export `AWS_PROFILE`, `PILOT_AWS_REGION`, `PILOT_AWS_ACCOUNT`, `PILOT_STATE_BUCKET`, and `PILOT_STATE_KEY`. The installer passes the region and account to Terraform explicitly.
3. Run `bash install.sh state` and verify the selected backend. If creation only partially succeeds, fix the missing bucket settings as an operator before rerunning the check. Then run `bash install.sh plan /absolute/private/path/pilot.tfplan`, substituting a new path in a restricted directory. The installer verifies the account, bucket, and release-asset checksums, initializes Terraform with locking, and saves the plan with a context file. Keep both files together.
4. Review the target account, repository scope, runner IAM, no-inbound security group, temporary public IP, worker cap, and idle resources. The plan should include no running EC2 instance. With approval, run `bash install.sh apply /absolute/private/path/pilot.tfplan`. The installer previews the saved plan and asks for confirmation. Read the endpoint with `terraform output -raw webhook_endpoint`.
5. In the GitHub App settings, enable the webhook, enter the endpoint and the same secret stored in Parameter Store, leave SSL verification enabled, and subscribe to **Workflow job**. Verify the installation still names only the pilot repo.

## 4. Prove the runner works

1. Confirm there are zero active pilot workers and no queued pilot jobs before dispatch. Run **Pilot runner smoke test** manually from the private repository's default branch.
2. Follow the job in GitHub and record the EC2 instance and boot-volume IDs while the worker exists. Confirm only one ARM64 worker launches and the workflow passes.
3. Verify the instance reaches `terminated`, its boot volume disappears, and the GitHub runner registration is removed. Record dispatch-to-start time, job duration, cleanup time, and any unexpected costs or manual steps.
4. If the job stays queued, check GitHub App delivery, then the AWS webhook, dispatcher, and scale-up logs in that order. A successfully received event can still be blocked by label matching, instance eligibility, or launch failure. Cancel a stalled test before retrying and check for leftover workers. Review logs without exposing credentials.

## 5. Pause or tear down

- **Pause:** Disable the GitHub App webhook, confirm the queue is drained and workers and disks are gone. Scheduled AWS tasks and storage remain provisioned. Re-enable the webhook when ready to resume.
- **Remove the stack:** Disable the webhook, let active jobs finish or cancel them explicitly, and verify worker cleanup. Use `bash install.sh destroy-plan /absolute/private/path/pilot-destroy.tfplan` with the same backend, inputs, and account. Review the exact deletions and obtain approval before running `bash install.sh apply` with that saved plan's path. Verify stack resources are gone. If a nonempty versioned bucket blocks teardown, review its contents and retention requirements before asking for deletion approval.
- **Retire external setup:** The state bucket, SSM inputs, GitHub App, and private repository were created outside the stack. Decide which to retain. For permanent retirement, have the operator revoke the App key and remove the installation and secret parameters. Archive state securely or remove it under the approved retention policy.

For the next rehearsal, have a second operator use a clean sandbox and this guide. Measure time from prerequisites ready to first passing job, log each point where the operator needed help, and verify teardown independently.
