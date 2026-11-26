"use client";

import { useState } from "react";

import {
  WorkPlanPanel,
  workModeBadgeClass,
  workModeLabel,
  type WorkPlanPanelData,
} from "@/components/work-plan-panel";

export type AttendanceDetailRecord = {
  id: string;
  type: string;
  timestampServer: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  distanceMeters: number;
  officeName: string | null;
  workMode: string;
  locationNote: string | null;
  workPlan: WorkPlanPanelData | null;
  approvalStatus: string;
  photoUrl: string;
  notes: string | null;
  deviceInfo: string | null;
  userAgent: string | null;
  faceVerified: boolean;
  isSuspicious: boolean;
};

export type AttendanceDetailGroup = {
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  checkIn: AttendanceDetailRecord | null;
  checkOut: AttendanceDetailRecord | null;
};

function stamp(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
  }).format(new Date(value));
}

function approvalLabel(value: string): string {
  if (value === "APPROVED") return "Disetujui";
  if (value === "REJECTED") return "Ditolak";
  return "Menunggu";
}

function RecordBlock({
  label,
  record,
}: {
  label: string;
  record: AttendanceDetailRecord | null;
}) {
  if (!record) {
    return (
      <div className="detail-block">
        <div className="detail-block-head">
          <strong>{label}</strong>
          <span className="badge badge--neutral">Belum ada</span>
        </div>
      </div>
    );
  }
  const mapsUrl = `https://www.google.com/maps?q=${record.latitude},${record.longitude}`;
  const embedUrl = `${mapsUrl}&z=17&output=embed`;
  return (
    <div className="detail-block">
      <div className="detail-block-head">
        <strong>{label}</strong>
        <span className="mono">{stamp(record.timestampServer)}</span>
      </div>
      <div className="detail-photo">
        {/* Endpoint foto memeriksa sesi dan tenant sebelum menyajikan bytes. */}
        <img src={record.photoUrl} alt={`Foto selfie ${label}`} loading="lazy" />
      </div>
      <dl className="detail-grid">
        <div>
          <dt>Mode kerja</dt>
          <dd>
            <span className={workModeBadgeClass(record.workMode)}>
              {workModeLabel(record.workMode)}
            </span>
            {record.locationNote ? (
              <span className="cell-sub">{record.locationNote}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{approvalLabel(record.approvalStatus)}</dd>
        </div>
        <div>
          <dt>Koordinat</dt>
          <dd className="mono">
            {record.latitude.toFixed(6)}, {record.longitude.toFixed(6)}
          </dd>
        </div>
        <div>
          <dt>Akurasi / jarak</dt>
          <dd className="mono">
            {record.accuracyMeters.toFixed(0)} m / {record.distanceMeters.toFixed(0)} m
          </dd>
        </div>
        <div>
          <dt>Lokasi</dt>
          <dd>{record.officeName ?? "Tanpa kantor"}</dd>
        </div>
        <div>
          <dt>Wajah</dt>
          <dd>{record.faceVerified ? "Terverifikasi" : "Tidak terverifikasi"}</dd>
        </div>
        <div>
          <dt>Perangkat</dt>
          <dd>{record.deviceInfo ?? "—"}</dd>
        </div>
        <div>
          <dt>User agent</dt>
          <dd className="detail-wrap">{record.userAgent ?? "—"}</dd>
        </div>
        <div className="detail-span">
          <dt>Catatan</dt>
          <dd>{record.notes ?? "—"}</dd>
        </div>
      </dl>
      <div className="detail-map">
        <iframe
          title={`Peta ${label} ${record.id}`}
          src={embedUrl}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="btn btn--secondary btn--sm">
          Buka di Google Maps
        </a>
      </div>
      {record.workPlan ? <WorkPlanPanel plan={record.workPlan} /> : null}
      {record.isSuspicious ? (
        <p className="alert" style={{ marginTop: "0.65rem" }}>
          Presensi ditandai mencurigakan oleh sistem.
        </p>
      ) : null}
    </div>
  );
}

export function AttendanceDetail({ group }: { group: AttendanceDetailGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen(true)}>
        Lihat Detail
      </button>
      {open ? (
        <div
          className="drawer-backdrop"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Detail kehadiran ${group.memberName}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <div>
                <p className="eyebrow">Detail kehadiran</p>
                <h2 className="section-title">{group.memberName}</h2>
                <p className="section-note">
                  {group.divisionName ?? group.memberEmail}
                </p>
              </div>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setOpen(false)}
              >
                Tutup
              </button>
            </div>
            <RecordBlock label="Masuk" record={group.checkIn} />
            <RecordBlock label="Pulang" record={group.checkOut} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
