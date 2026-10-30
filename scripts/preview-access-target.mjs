// Only the trusted-main workflow supplies this target; live guards still run
// before every privileged mutation in the provisioning helpers.
export function previewAccessTarget({
  eventName,
  event,
  targetNumber,
  repository,
}) {
  const coded = (code) =>
    Object.assign(new Error('Preview access request failed'), { code });
  if (!Number.isSafeInteger(targetNumber) || targetNumber < 1)
    throw coded('TARGET_INVALID');
  if (eventName === 'pull_request_target') {
    if (!['opened', 'reopened', 'ready_for_review'].includes(event.action))
      throw new Error('Unsupported PR action');
    if (
      !Number.isSafeInteger(event.number) ||
      event.number < 1 ||
      event.pull_request?.number !== event.number ||
      event.pull_request?.head?.repo?.full_name !== repository ||
      event.pull_request?.base?.repo?.full_name !== repository ||
      event.pull_request?.state !== 'open' ||
      !/^[0-9a-f]{40}$/.test(event.pull_request?.head?.sha ?? '')
    )
      throw new Error('Untrusted PR event');
    if (event.number !== targetNumber) throw coded('TARGET_MISMATCH');
    return event.pull_request.head.sha;
  }
  if (eventName === 'workflow_dispatch') {
    if (Number(event.inputs?.pr_number) !== targetNumber)
      throw coded('TARGET_MISMATCH');
    // A manual run freezes the current live SHA inside provisionPreview.
    return undefined;
  }
  throw new Error('Unsupported event');
}
