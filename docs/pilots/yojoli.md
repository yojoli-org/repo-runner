# Yojoli pilot

Yojoli is Repo Runner's first customer. This brief records requirements for its installation. See the [implementation plan](../plan.md) for product-wide milestones.

- Use the [Yojoli runner placement contract](https://github.com/yojoli-org/yojoli/blob/main/docs/runner-placement.md) to verify job routing and isolation. Existing workflows select Linux ARM64 runners with the `oci` and `yojoli-ephemeral` labels. Some also require `heavy`. Any selector changes need maintainer approval before cutover.
- Preserve the host's root-owned container allowlist and pinned job images. Verify that the upstream module's bootstrap hooks can enforce them. Run a representative heavy job from zero workers and confirm cleanup. Separately confirm that an unapproved image is rejected.
- Keep `agent-ready` and other work eligibility rules in Yojoli. Before cutover, separately verify that idle scheduled checks do not dispatch jobs when there is no eligible work.
