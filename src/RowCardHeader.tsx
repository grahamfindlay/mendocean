import type { ReactNode } from "react";
import { formatDate, formatTime, type Outing } from "../shared/domain";

export function RowCardHeader({
  outing,
  attendance,
  trailing,
  showKind = false,
  inProgress = false,
}: {
  outing: Outing;
  attendance?: ReactNode;
  trailing?: ReactNode;
  showKind?: boolean;
  inProgress?: boolean;
}) {
  return (
    <div className="row-card-header">
      <div className="scheduled-card-top">
        <span className="row-meta">{formatDate(outing.starts_at)}</span>
        {attendance}
      </div>
      <span className="row-meta">
        {formatTime(outing.starts_at)} – {formatTime(outing.ends_at)}
        {inProgress && <span className="phase-label"> · In progress</span>}
      </span>
      <div className="scheduled-card-top">
        <h3 className="row-meta">{outing.title}</h3>
        {trailing}
      </div>
      {showKind && (
        <span className="row-kind">
          {outing.kind === "official" ? "Practice" : "Independent"}
        </span>
      )}
    </div>
  );
}
