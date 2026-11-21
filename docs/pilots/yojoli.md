# Yojoli pilot

Yojoli is Repo Runner's first customer. This brief records requirements for its installation. See the [implementation plan](../plan.md) for product-wide milestones.

- Use the [Yojoli runner placement contract](https://github.com/yojoli-org/yojoli/blob/main/docs/runner-placement.md) to verify job routing and isolation. Existing workflows select Linux ARM64 runners with the `oci` and `yojoli-ephemeral` labels. Some also require `heavy`. Any selector changes need maintainer approval before cutover.
- Preserve the host's root-owned container allowlist and pinned job images. Verify that the upstream module's bootstrap hooks can enforce them. Run a representative heavy job from zero workers and confirm cleanup. Separately confirm that an unapproved image is rejected.
- Keep `agent-ready` and other work eligibility rules in Yojoli. Before cutover, separately verify that idle scheduled checks do not dispatch jobs when there is no eligible work.

## Proposed AWS isolation and sizing test

Use one disposable `t4g.small` in the private pilot repository. EC2 termination can take over host and disk cleanup from the OCI slot lifecycle. The upstream Linux bootstrap adds `ec2-user` to the Docker group, so its default listener setup does not preserve Yojoli's Docker boundary. Keep digest enforcement and a privileged Docker boundary for this test. Prefer the documented upstream installation hook and a small operator-owned adapter over porting the OCI broker and timers. Review the current host wrapper with the Yojoli operator before implementing the adapter.

1. Before registering a runner, provision a dedicated non-root listener identity with no sudo, Docker socket access, or Docker group membership. Install the root-owned wrapper and allowlist with exactly the current workflow's approved image digest. Use a separate pilot label and abort startup if any required control is missing. Keep the pilot stack's checkout access empty during this stage.
2. In the private pilot, first run a harmless container job using the approved digest. Verify that the job runs unprivileged, cannot reach the Docker socket or EC2 instance metadata, and cannot read runner or control-plane credentials. Separately request an unapproved image and verify the host rejects it before the image starts. Confirm both runs leave zero workers and no job disks, including on rejection.
3. After the isolation checks pass, have the maintainer authorize read-only access for one checkout of a pinned Yojoli `main` commit. Run `npm ci --no-audit --no-fund` and one representative unit build in the approved container. Record job and cold-start duration, host memory, cgroup memory peak and OOM counters. Record runtime filesystem usage separately because the OCI configuration uses tmpfs. Retry on a larger approved allocation only if the 2 GiB results justify it.

This is a pilot design for maintainer review. Any change to the production isolation contract, filesystem guarantees, GitHub access or Yojoli workflow routing requires a separate decision.
