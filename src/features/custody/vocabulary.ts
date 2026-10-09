/** Display labels only: database operations and export machine values stay unchanged. */
export function custodyEventLabel(
  operation: string,
  kind: 'quantity' | 'asset',
) {
  const labels: Record<string, string> = {
    issued: kind === 'asset' ? 'Assigned to site' : 'Issued to site',
    assigned: 'Assigned to site',
    returned: 'Returned from site',
    transferred: 'Transferred between sites',
    corrected:
      kind === 'quantity' ? 'Site count corrected' : 'Site custody corrected',
    written_off:
      kind === 'quantity'
        ? 'Quantity written off at site'
        : 'Asset written off at site',
    retired: 'Asset retired at site',
    opening: 'Site opening recorded',
    opened: 'Site opening recorded',
  };
  const aliases: Record<string, string> = {
    issue: 'issued',
    assign: 'assigned',
    return: 'returned',
    transfer: 'transferred',
    correct: 'corrected',
    write_off: 'written_off',
    retire: 'retired',
  };
  const key = operation.replace(/^site_/, '');
  return labels[aliases[key] ?? key] ?? 'Custody updated';
}
