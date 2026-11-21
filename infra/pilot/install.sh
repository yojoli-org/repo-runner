#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  printf '%s\n' 'Usage: bash install.sh {state|plan|destroy-plan|apply} [plan-file]' \
    'Set AWS_PROFILE, PILOT_AWS_REGION, PILOT_AWS_ACCOUNT, PILOT_STATE_BUCKET, PILOT_STATE_KEY.'
}

action=${1:-}
case "$action" in
  state) [[ $# -eq 1 ]] || { usage; exit 2; } ;;
  plan|destroy-plan|apply) [[ $# -eq 2 && $2 = /* ]] || { usage; exit 2; } ;;
  *) usage; exit 2 ;;
esac

: "${AWS_PROFILE:?Set the sandbox AWS CLI profile}"
: "${PILOT_AWS_REGION:?Set the sandbox AWS region}"
: "${PILOT_AWS_ACCOUNT:?Set the expected sandbox account ID}"
: "${PILOT_STATE_BUCKET:?Set the dedicated state bucket}"
: "${PILOT_STATE_KEY:?Set a unique state key for this installation}"
[[ $PILOT_AWS_ACCOUNT =~ ^[0-9]{12}$ ]] || { echo 'Invalid AWS account ID.' >&2; exit 2; }

aws_pilot() { aws --profile "$AWS_PROFILE" --region "$PILOT_AWS_REGION" --no-cli-pager "$@"; }
actual_account=$(aws_pilot sts get-caller-identity --query Account --output text)
[[ $actual_account == "$PILOT_AWS_ACCOUNT" ]] || { echo 'AWS profile points to a different account.' >&2; exit 1; }

bucket_command() {
  local operation=$1
  shift
  aws_pilot s3api "$operation" --bucket "$PILOT_STATE_BUCKET" --expected-bucket-owner "$PILOT_AWS_ACCOUNT" "$@"
}

confirm() {
  local answer
  printf '%s Type yes to continue: ' "$1" >&2
  read -r answer
  [[ $answer == yes ]] || { echo 'Stopped without making the proposed change.' >&2; exit 1; }
}

verify_state_bucket() {
  local location blocked versioning encryption
  location=$(bucket_command get-bucket-location --query LocationConstraint --output text)
  [[ $location != None || $PILOT_AWS_REGION != us-east-1 ]] || location=us-east-1
  blocked=$(bucket_command get-public-access-block --query \
    'PublicAccessBlockConfiguration.BlockPublicAcls && PublicAccessBlockConfiguration.IgnorePublicAcls && PublicAccessBlockConfiguration.BlockPublicPolicy && PublicAccessBlockConfiguration.RestrictPublicBuckets' --output text)
  versioning=$(bucket_command get-bucket-versioning --query Status --output text)
  encryption=$(bucket_command get-bucket-encryption --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text)
  if [[ $location != "$PILOT_AWS_REGION" || $blocked != True || $versioning != Enabled || $encryption == None || -z $encryption ]]; then
    echo 'State bucket must be in the pilot region, versioned, encrypted, and block all public access.' >&2
    exit 1
  fi
}

if [[ $action == state ]]; then
  if result=$(bucket_command head-bucket 2>&1); then
    verify_state_bucket
  else
    if [[ $result != *'(404)'* && $result != *'(NotFound)'* ]]; then
      printf '%s\n' "$result" >&2
      exit 1
    fi
    if [[ $PILOT_AWS_REGION == us-east-1 ]]; then
      echo 'Provide a pre-created state bucket in us-east-1.' >&2
      exit 1
    fi
    confirm "Create state bucket $PILOT_STATE_BUCKET in $PILOT_AWS_REGION?"
    aws_pilot s3api create-bucket --bucket "$PILOT_STATE_BUCKET" --object-ownership BucketOwnerEnforced \
      --create-bucket-configuration "LocationConstraint=$PILOT_AWS_REGION"
    bucket_command put-public-access-block --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
    bucket_command put-bucket-encryption --server-side-encryption-configuration \
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
    bucket_command put-bucket-versioning --versioning-configuration Status=Enabled
    verify_state_bucket
  fi
  echo 'State bucket verified.'
  exit 0
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
verify_state_bucket
shasum -a 256 -c artifacts.sha256
terraform init -input=false -reconfigure -lockfile=readonly \
  -backend-config="bucket=$PILOT_STATE_BUCKET" \
  -backend-config="key=$PILOT_STATE_KEY" \
  -backend-config="region=$PILOT_AWS_REGION" \
  -backend-config="allowed_account_ids=[\"$PILOT_AWS_ACCOUNT\"]"

plan_file=$2
plan_context() {
  printf '%s\n' "$PILOT_AWS_ACCOUNT" "$PILOT_AWS_REGION" "$PILOT_STATE_BUCKET" "$PILOT_STATE_KEY"
  shasum -a 256 < "$plan_file"
}

case "$action" in
  plan|destroy-plan)
    if [[ -e $plan_file || -L $plan_file || -e $plan_file.context || -L $plan_file.context ]]; then
      echo 'Choose a new path for the saved plan.' >&2
      exit 1
    fi
    plan_args=()
    [[ $action != destroy-plan ]] || plan_args=(-destroy)
    terraform plan -input=false -out="$plan_file" \
      -var="aws_region=$PILOT_AWS_REGION" -var="sandbox_account_id=$PILOT_AWS_ACCOUNT" ${plan_args[@]+"${plan_args[@]}"}
    (set -o noclobber; plan_context > "$plan_file.context")
    ;;
  apply)
    if [[ ! -f $plan_file || ! -f $plan_file.context ]] || ! plan_context | cmp -s - "$plan_file.context"; then
      echo 'Saved plan is missing, changed, or belongs to another AWS state. Generate a new plan.' >&2
      exit 1
    fi
    terraform show -no-color "$plan_file"
    confirm "Apply this saved plan for sandbox account $PILOT_AWS_ACCOUNT?"
    terraform apply -input=false "$plan_file"
    ;;
esac
