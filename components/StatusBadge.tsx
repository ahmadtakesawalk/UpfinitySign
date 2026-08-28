const STATUS_MAP: Record<string, { label: string; className: string }> = {
  completed: { label: "Completed", className: "badge-success" },
  signed: { label: "Signed", className: "badge-success" },
  approved: { label: "Approved", className: "badge-success" },
  active: { label: "Active", className: "badge-success" },
  sent: { label: "Sent", className: "badge-pending" },
  delivered: { label: "Delivered", className: "badge-pending" },
  opened: { label: "Opened", className: "badge-warning" },
  pending: { label: "Pending", className: "badge-pending" },
  draft: { label: "Draft", className: "badge-pending" },
  declined: { label: "Declined", className: "badge-danger" },
  voided: { label: "Voided", className: "badge-danger" },
  expired: { label: "Expired", className: "badge-danger" },
  suspended: { label: "Suspended", className: "badge-danger" },
  revoked: { label: "Revoked", className: "badge-danger" },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_MAP[status] ?? { label: status, className: "badge-pending" };
  return <span className={`badge ${entry.className}`}>{entry.label}</span>;
}
