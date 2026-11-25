#!/usr/bin/env bash
set -euo pipefail
umask 077
export TF_IN_AUTOMATION=1 AWS_PAGER=''

case ${RR_RECOVERY_PREVIEW:-0} in
  0) ;;
  1) [[ ${RR_DEPLOY:-0} == 1 ]] ;;
  *) echo 'Invalid recovery preview setting.' >&2; exit 2 ;;
esac

[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT_ID" ]]
subnets=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$PILOT_VPC" "Name=subnet-id,Values=$PILOT_SUBNETS" --query 'Subnets[].SubnetId' --output json)
export RR_ACTUAL_SUBNETS="$subnets"
quota=$(aws lambda get-account-settings --query AccountLimit.ConcurrentExecutions --output text)
[[ "$quota" =~ ^[0-9]+$ ]]
export RR_SCALE_UP_SLOTS=1
if (( quota <= 10 )); then
  export RR_SCALE_UP_SLOTS=-1
fi

python3 - <<'PY'
import json
import os

def env(key):
    return os.environ[key]

subnets = env('PILOT_SUBNETS').split(',')
if sorted(subnets) != sorted(json.loads(env('RR_ACTUAL_SUBNETS'))):
    raise SystemExit('The selected subnets do not all belong to the selected VPC.')

region, account, prefix = env('AWS_REGION'), env('EXPECTED_ACCOUNT_ID'), env('PILOT_PREFIX')

def parameter(suffix):
    name = f'/repo-runner/{prefix}/{suffix}'
    return {'name': name, 'arn': f'arn:aws:ssm:{region}:{account}:parameter{name}'}

with open('terraform.tfvars.json', 'x') as output:
    json.dump({
        'aws_region': region, 'sandbox_account_id': account, 'prefix': prefix,
        'vpc_id': env('PILOT_VPC'), 'subnet_ids': subnets, 'pilot_repository': env('PILOT_REPOSITORY'),
        'scale_up_reserved_concurrent_executions': int(env('RR_SCALE_UP_SLOTS')),
        'runtime_permissions_boundary_arn': env('PILOT_RUNTIME_BOUNDARY') if os.environ.get('RR_DEPLOY') == '1' else None,
        'github_app_parameters': {'id_ssm': parameter('app-id'), 'key_base64_ssm': parameter('app-key-base64'),
                                  'webhook_secret_ssm': parameter('webhook-secret')},
    }, output)
PY

work=$(mktemp -d)
trap 'rm -r -- "$work"' EXIT
version=1.17.2
archive=terraform_${version}_linux_amd64.zip
curl -fsS --retry 2 --max-time 90 "https://releases.hashicorp.com/terraform/$version/$archive" -o "$work/$archive"
(cd "$work" && printf '%s  %s\n' e6f16b2f0b137ee5729caa8c4e79a3bae4ee261acd198a1fcfa8584a6296605b "$archive" | sha256sum -c -)
unzip -q "$work/$archive" terraform -d "$work"
sha256sum -c artifacts.sha256
tf="$work/terraform"
backend=()
if [[ ${RR_DEPLOY:-0} == 1 ]]; then
  bucket_query() {
    aws s3api "$1" --bucket "$PILOT_STATE_BUCKET" --expected-bucket-owner "$EXPECTED_ACCOUNT_ID" --query "$2" --output text
  }
  location=$(bucket_query get-bucket-location LocationConstraint)
  [[ "$location" != None ]] || location=us-east-1
  [[ "$location" == "$AWS_REGION" ]]
  [[ $(bucket_query get-bucket-versioning Status) == Enabled ]]
  block='PublicAccessBlockConfiguration.BlockPublicAcls && PublicAccessBlockConfiguration.IgnorePublicAcls && PublicAccessBlockConfiguration.BlockPublicPolicy && PublicAccessBlockConfiguration.RestrictPublicBuckets'
  [[ $(bucket_query get-public-access-block "$block") == True ]]
  encryption=$(bucket_query get-bucket-encryption 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm')
  [[ -n "$encryption" && "$encryption" != None ]]
  backend=(
    "-backend-config=bucket=$PILOT_STATE_BUCKET"
    "-backend-config=key=browser-deploy/$PILOT_PREFIX/pilot.tfstate"
    "-backend-config=region=$AWS_REGION"
    "-backend-config=allowed_account_ids=[\"$EXPECTED_ACCOUNT_ID\"]"
  )
fi
"$tf" init -input=false -lockfile=readonly -no-color "${backend[@]}"
if ! "$tf" plan -input=false -out="$work/preview.tfplan" -no-color > "$work/plan.log" 2>&1; then
  awk '/^Error:/ {print}' "$work/plan.log" >&2
  exit 1
fi
"$tf" show -json "$work/preview.tfplan" | python3 -c '
import json, os, sys
from collections import Counter
plan = json.load(sys.stdin)
changes = [r for r in plan["resource_changes"] if r["change"]["actions"] not in (["no-op"], ["read"])]
if os.environ.get("RR_RECOVERY_PREVIEW") == "1":
    counts = Counter("/".join(r["change"]["actions"]) for r in changes)
    print(json.dumps({"result":"recovery_preview_ready", "actions":dict(counts)}, sort_keys=True))
    sys.exit(0)
if not changes or any(r["change"]["actions"] != ["create"] or r["type"] == "aws_instance" for r in changes):
    raise SystemExit("Expected a create-only preview with no running EC2 instances.")
if os.environ.get("RR_DEPLOY") == "1":
    boundary = os.environ["PILOT_RUNTIME_BOUNDARY"]
    path = "/" + os.environ["PILOT_PREFIX"] + "/"
    roles = [r["change"]["after"] for r in changes if r["type"] == "aws_iam_role"]
    if not roles or any(role.get("permissions_boundary") != boundary or role.get("path") != path for role in roles):
        raise SystemExit("Every new role must have the approved permissions boundary and pilot path.")
print(json.dumps({"result":"preview_ready", "create_count":len(changes), "region":os.environ["AWS_REGION"],
                  "scale_up_reserved_slots":int(os.environ["RR_SCALE_UP_SLOTS"])}))
'
if [[ ${RR_DEPLOY:-0} == 1 && ${RR_RECOVERY_PREVIEW:-0} == 0 ]]; then
  "$tf" apply -input=false -no-color "$work/preview.tfplan"
  printf '%s\n' 'Runner pool deployed. GitHub setup and smoke verification are pending.'
fi
