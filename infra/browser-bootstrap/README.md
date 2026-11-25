# Browser launch proof

This rehearsal checks whether a customer can approve an AWS console deployment that starts a job in their own account. The template creates a dedicated CodeBuild project and log group, a Lambda launcher, and two service roles. The build verifies its AWS account and reads the regional Lambda concurrency quota. It uses no source checkout, GitHub credentials, privileged build container, or runner deployment permissions. The build can incur AWS charges.

1. Validate the template and review its IAM resources. Publish the reviewed template to a private S3 bucket and use a short-lived presigned URL for the rehearsal. Keep the URL out of logs and committed files.
2. Create a [CloudFormation Quick Create link](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stacks-quick-create-links.html) using the customer's region, a unique stack name, the URL-encoded template URL, and `param_ExpectedAccountId` set to their AWS test account.
3. In the customer console, verify the account, region, and template. Acknowledge IAM resource creation and create the stack.
4. Check the `BuildId` stack output and confirm that exact CodeBuild execution reached `SUCCEEDED`. The build should print the regional quota and `Browser bootstrap proof passed`. Stack creation confirms dispatch only.
5. After the build finishes, delete the proof stack and verify that its project, log group, launcher, and roles are gone. Remove the staged template when the rehearsal is complete.

This proves the browser approval and in-account execution boundary. Repo Runner provisioning, GitHub approval, smoke testing and portal progress reporting are separate work.

## Browser-started Terraform preview

The next rehearsal uses the same CloudFormation approval and launcher to generate a real plan for a new runner pool. It starts from empty local state, scopes the build to one versioned source ZIP, and gives the build role only source read, logs, and AWS discovery permissions. The build prints a create-only summary and discards the temporary plan. This preview is for inspection. It cannot authorize deployment.

From a reviewed checkout, download the pinned assets as described in [the pilot README](../pilot/README.md). Then generate the preview artifacts:

```bash
bash infra/browser-bootstrap/package-plan.sh /absolute/path/to/runner-assets /private/path/plan-source.zip
node infra/browser-bootstrap/make-plan-template.mjs > /private/path/plan-template.json
```

Stage the source ZIP at a unique key under `browser-bootstrap/` in a private, versioned bucket in the customer account. Stage the generated template separately. Use the source object’s exact version in the Quick Create link. Prefill `ExpectedAccountId`, `SourceBucket`, `SourceKey`, `SourceVersion`, `Repository`, `PilotPrefix`, `VpcId`, and the comma-separated `SubnetIds`. Use nonsecret sandbox inputs. The selected subnets must belong to the target VPC. For eventual runner deployment, they must also provide outbound access as described in the pilot README.

In the live rehearsal, verify that the exact build reaches `SUCCEEDED` and reports `preview_ready`, the number of planned resources, and the selected Lambda reservation. A 10-slot account should report shared concurrency (`-1`) for this preview. No runner pool should appear in the account. Delete the proof stack and staged source and template versions afterward.

The customer-facing flow will offer details on demand. Applying an approved deployment, wiring GitHub, and showing the result in the portal are separate milestones.

## Browser-started sandbox deployment

The deployment variant uses the same AWS confirmation to start a build that creates a new runner pool. The build checks the customer account and its state bucket, creates a saved plan, rejects changes to existing resources or a plan that launches an EC2 worker, and applies that same plan. It writes encrypted, locked state at `browser-deploy/<pilot-prefix>/pilot.tfstate`. The preview variant remains available on its own.

An AWS administrator must first provide a customer-owned CodeBuild service role named `rr-bootstrap-…`. Scope its trust to the exact CodeBuild project and customer account. Restrict who can modify or start the project, since a caller allowed to override the build inputs can use its service role. Review its permissions for the pinned source object, build logs, the exact state and lock keys, and operations on the dedicated pilot resources. The launcher will use the role only in the account where the stack is created. The deployment template does not grant those permissions. An approved deployment role and its policy still need a live rehearsal.

Generate the deployment pair from the reviewed checkout:

```bash
bash infra/browser-bootstrap/package-plan.sh /absolute/path/to/runner-assets /private/path/deploy-source.zip --deploy
node infra/browser-bootstrap/make-plan-template.mjs --deploy > /private/path/deploy-template.json
```

Stage the pair as in the preview instructions. In addition to the preview inputs, prefill `DeploymentRoleName`, `StateBucket`, and `RuntimeBoundaryName`. The boundary must be a customer-managed policy in the deployment account. Every runtime role in the saved plan must use that boundary and the pilot IAM path. Use an unused pilot prefix and a private, encrypted, versioned bucket in the same account and region. The AWS console approval authorizes the named sandbox deployment. For a preview first, use the preview template instead.

After deployment, the pool is waiting for GitHub configuration and smoke verification. The CodeBuild job does not receive App credentials. Delete the runner pool using the matching Terraform configuration and state before retiring the bootstrap stack. If a build fails after applying any resources, inspect that state before retrying.

### Deployment role review

The guided rehearsal created resources through API Gateway, EC2 launch templates and security groups, EventBridge, IAM, Lambda, CloudWatch Logs, S3, SQS, and Systems Manager. The CodeBuild policy needs to cover each resource's create and Terraform read operations. CloudTrail management events are a starting inventory. They omit some permissions checked during a call, such as `iam:PassRole`, and do not include ordinary S3 object events by default.

A deployment role must restrict IAM changes to the pilot role and instance-profile path. Require the approved boundary when creating roles, deny removing or changing it, and restrict `iam:PassRole` to the intended AWS services and pilot roles. The deployment role must have no ability to modify the boundary policy or its own permissions. Review the runtime boundary's permissions for the actual pool before a live apply.
