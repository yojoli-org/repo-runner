export function awsDeploymentLink({ account, region, bucket, templateKey, stackName, repository }) {
  if (!/^\d{12}$/.test(account ?? '')
    || !/^[a-z]{2}-(?:[a-z]+-)+\d+$/.test(region ?? '') || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? '')
    || !/^browser-bootstrap\/[A-Za-z0-9_-]+\/combined[.]json$/.test(templateKey ?? '')
    || !/^rr-[a-z0-9-]{1,80}$/.test(stackName ?? '') || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('The sandbox AWS deployment details are invalid.');
  }
  const consoleUrl = new URL(`https://${region}.console.aws.amazon.com/cloudformation/home`);
  consoleUrl.searchParams.set('region', region);
  const setup = new URLSearchParams({
    templateURL: `https://${bucket}.s3.${region}.amazonaws.com/${templateKey}`, stackName,
  });
  consoleUrl.hash = '/stacks/create/review?' + setup;
  return consoleUrl.href;
}
