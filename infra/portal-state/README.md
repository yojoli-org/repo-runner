# Portal registration state

Deploy one DynamoDB table per portal environment in Repo Runner's AWS account. Customers share the table within that environment. Attempts are scoped to a tenant and user in the [registration adapter](../../onboarding/registration-attempts.mjs). The table stores temporary onboarding metadata. GitHub App keys and webhook secrets belong in the customer's AWS Parameter Store.

Set the portal account, region, and table name explicitly. Initialize the S3 backend with a private, encrypted, versioned state bucket and a unique state key in Repo Runner's account. Use an approved portal deployment profile and review the Terraform plan before applying. This stack is independent of the customer runner stack.

The portal runtime needs `dynamodb:PutItem` and `dynamodb:UpdateItem` on the table ARN. Keep that role separate from the customer's deployment role. The adapter enforces the expiry in its conditional write because DynamoDB TTL deletion is asynchronous.

For local checks, run `terraform fmt -check`, `terraform init -backend=false -lockfile=readonly`, and `terraform validate` in this directory. Run `node --test onboarding/*.test.mjs` from the repository root.
