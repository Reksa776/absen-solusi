import { HttpError, readJsonBody, type CorrectionProof } from "@absensi/auth";

export type CorrectionSubmitPayload = {
  attendanceLogId: string | null;
  requestType: string;
  requestedTimestamp: string;
  reason: string;
  proof: CorrectionProof | null;
};

function textField(value: FormDataEntryValue | unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * JSON untuk pengajuan tanpa bukti, multipart bila ada bukti. Bukti base64 di
 * body JSON ditolak agar file tidak pernah masuk database.
 */
export async function parseCorrectionSubmit(
  request: Request,
): Promise<CorrectionSubmitPayload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("proof");
    let proof: CorrectionProof | null = null;
    if (file instanceof File && file.size > 0) {
      proof = {
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
        contentType: file.type,
      };
    }
    return {
      attendanceLogId: textField(form.get("attendanceLogId")) || null,
      requestType: textField(form.get("requestType")),
      requestedTimestamp: textField(form.get("requestedTimestamp")),
      reason: textField(form.get("reason")),
      proof,
    };
  }

  const body = await readJsonBody(request);
  if (body.proof !== undefined && body.proof !== null) {
    throw new HttpError(400, "INVALID_PROOF", "Bukti harus dikirim sebagai multipart");
  }
  return {
    attendanceLogId: typeof body.attendanceLogId === "string" ? body.attendanceLogId.trim() : null,
    requestType: typeof body.requestType === "string" ? body.requestType.trim() : "",
    requestedTimestamp:
      typeof body.requestedTimestamp === "string" ? body.requestedTimestamp.trim() : "",
    reason: typeof body.reason === "string" ? body.reason.trim() : "",
    proof: null,
  };
}
