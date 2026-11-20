import type { AttendancePhoto, AttendanceType } from "@absensi/auth";

export function numberField(form: FormData, key: string): number {
  const raw = form.get(key);
  const value = typeof raw === "string" ? Number(raw) : Number.NaN;
  return value;
}

export async function photoField(form: FormData): Promise<AttendancePhoto> {
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Foto wajib dikirim sebagai multipart field photo");
  }
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    filename: file.name || "photo.jpg",
    contentType: file.type,
  };
}

export function attendanceType(path: string): AttendanceType {
  return path.endsWith("check-out") ? "CHECK_OUT" : "CHECK_IN";
}
