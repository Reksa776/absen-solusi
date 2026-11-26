export type WorkPlanPanelData = {
  workMode: string;
  locationNote: string | null;
  planAttachmentUrl: string | null;
  summaryNote: string | null;
  items: {
    id: string;
    title: string;
    isCompleted: boolean;
  }[];
  completedCount: number;
  totalCount: number;
};

export function workModeBadgeClass(mode: string): string {
  if (mode === "WFH") return "badge badge--green";
  if (mode === "WFC") return "badge badge--yellow";
  if (mode === "OUT_OF_TOWN") return "badge badge--red";
  return "badge badge--neutral";
}

export function workModeLabel(mode: string): string {
  if (mode === "WFH") return "WFH";
  if (mode === "WFC") return "WFC";
  if (mode === "OUT_OF_TOWN") return "Luar kota";
  return "WFO";
}

/** Rencana kerja + lampiran; dipakai di detail kehadiran dan review WFH/WFC. */
export function WorkPlanPanel({ plan }: { plan: WorkPlanPanelData }) {
  const ratio = `${plan.completedCount}/${plan.totalCount} Selesai`;
  return (
    <div className="work-plan">
      <div className="work-plan-head">
        <strong>Rencana kerja</strong>
        <span className="work-plan-progress num">{ratio}</span>
      </div>
      {plan.locationNote ? (
        <p className="work-plan-location">
          <span className={workModeBadgeClass(plan.workMode)}>
            {workModeLabel(plan.workMode)}
          </span>{" "}
          {plan.locationNote}
        </p>
      ) : null}
      {plan.planAttachmentUrl ? (
        <div className="detail-photo">
          <img
            src={plan.planAttachmentUrl}
            alt="Lampiran gambar rencana kerja"
            loading="lazy"
          />
        </div>
      ) : null}
      <ul className="work-plan-list">
        {plan.items.map((item) => (
          <li
            key={item.id}
            className={`work-plan-item${item.isCompleted ? " work-plan-item--done" : ""}`}
          >
            <span
              className={`work-plan-check${item.isCompleted ? "" : " work-plan-check--empty"}`}
              aria-hidden="true"
            >
              {item.isCompleted ? "✓" : "○"}
            </span>
            <span>{item.title}</span>
            <span className="sr-only">
              {item.isCompleted ? "selesai" : "belum selesai"}
            </span>
          </li>
        ))}
      </ul>
      {plan.summaryNote ? <p className="work-plan-note">{plan.summaryNote}</p> : null}
    </div>
  );
}
