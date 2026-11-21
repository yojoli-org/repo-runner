# Yojoli pilot

Yojoli is Repo Runner's first customer. This brief records requirements for its installation. See the [implementation plan](../plan.md) for product-wide milestones.

- Use the [Yojoli runner placement contract](https://github.com/yojoli-org/yojoli/blob/main/docs/runner-placement.md) to verify job routing and isolation. Existing workflows select Linux ARM64 runners with the `oci` and `yojoli-ephemeral` labels. Some also require `heavy`. Any selector changes need maintainer approval before cutover.
- Review the [current host isolation contract](https://github.com/yojoli-org/yojoli/blob/main/docs/runner-host-isolation.md) before recommending any production migration. The AWS private sandbox can test standard Docker compatibility under the product's disposable-VM model without assuming the two isolation models are equivalent.
- Keep `agent-ready` and other work eligibility rules in Yojoli. Before cutover, separately verify that idle scheduled checks do not dispatch jobs when there is no eligible work.

## AWS compatibility and sizing test

Use one disposable `t4g.small` per job in the private pilot repository. Use synthetic fixtures for initial compatibility checks. EC2 handles instance and disk cleanup. The existing OCI wrapper and single-image policy remain specific to that installation.

1. Run the manual shell, job-container, and Docker build probes in the private pilot. Verify native ARM64 execution and that each run returns to zero instances and disk volumes. Test service containers before claiming support for them.
2. Review the worker's effective IAM and network access against the control plane. Confirm the worker profile cannot access the GitHub App key, webhook secret, Terraform state or deployment roles. Verify cleanup after a failed or canceled job before routing customer workloads.
3. After those checks pass, have the maintainer authorize read-only access for one checkout of a pinned Yojoli `main` commit. Run `npm ci --no-audit --no-fund` and one representative build. Record job and cold-start duration, host and cgroup peak memory and OOM counters. Retry on a larger approved allocation if the 2 GiB results justify it.

This is a pilot design for maintainer review. Any change to the production isolation contract, filesystem guarantees, GitHub access or Yojoli workflow routing requires a separate decision.
