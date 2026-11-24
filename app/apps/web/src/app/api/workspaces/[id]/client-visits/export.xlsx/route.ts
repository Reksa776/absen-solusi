import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import ExcelJS from "exceljs";

import {
  clientVisitPhotoDirectory,
  fitImageWithin,
  listWorkspaceClientVisitExportRows,
  readCompanyLogo,
  requirePermission,
  reverseGeocodeCoordinates,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JAKARTA = "Asia/Jakarta";
const HEADERS = [
  "Nama Karyawan",
  "Jabatan",
  "Nama Klien",
  "Waktu Datang",
  "Waktu Pulang",
  "Durasi",
  "Foto Datang",
  "Foto Pulang",
  "Catatan Datang",
  "Catatan Pulang",
  "Alamat Datang",
  "Alamat Pulang",
] as const;
const WIDTHS = [
  24.5, 23.7, 44.0, 15.6, 13.0, 15.0, 11.6, 11.4, 33.3, 14.3, 113.1, 103.3,
] as const;
const PHOTO_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

type EmbeddedImage = {
  base64: string;
  extension: "jpeg" | "png";
};

type LogoImage = EmbeddedImage & {
  width: number;
  height: number;
};

function dateParts(value: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: JAKARTA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return Object.fromEntries(
    formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
}

function dateTimeLabel(value: string): string {
  const p = dateParts(value);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function headerDay(value: Date, withYear: boolean): string {
  const formatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: JAKARTA,
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
  return formatter.format(value).replace(/\./g, "");
}

function durationLabel(checkInAt: string | null, checkOutAt: string | null): string {
  if (!checkInAt || !checkOutAt) return "";
  const minutes = Math.max(
    0,
    Math.round((new Date(checkOutAt).getTime() - new Date(checkInAt).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} menit`;
}

function locationLabel(
  address: string | null,
  latitude: number | null,
  longitude: number | null,
): string {
  if (latitude === null || longitude === null) return address ?? "";
  const coordinates = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  return `${address ?? coordinates}\nhttps://www.google.com/maps?q=${latitude},${longitude}`;
}

function reportRangeDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function thinBorder(argb: string): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb } };
  return { top: side, left: side, bottom: side, right: side };
}

async function readPhotoImage(fileName: string | null): Promise<EmbeddedImage | null> {
  if (!fileName || !PHOTO_FILE_PATTERN.test(basename(fileName))) return null;
  const lower = fileName.toLowerCase();
  const extension = lower.endsWith(".png")
    ? "png"
    : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "jpeg"
      : null;
  if (!extension) return null;
  const directory = resolve(clientVisitPhotoDirectory());
  const path = resolve(join(directory, basename(fileName)));
  if (!path.startsWith(`${directory}/`)) return null;
  try {
    return { base64: (await readFile(path)).toString("base64"), extension };
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const data = await listWorkspaceClientVisitExportRows({
      ctx,
      workspaceId: id,
      from: from ?? undefined,
      to: to ?? undefined,
      memberId: url.searchParams.get("memberId") ?? undefined,
    });
    const rows = data.rows;

    let logo: LogoImage | null = null;
    try {
      const file = await readCompanyLogo({ ctx, workspaceId: id });
      const extension =
        file.contentType === "image/png"
          ? "png"
          : file.contentType === "image/jpeg"
            ? "jpeg"
            : null;
      if (extension) {
        const size = fitImageWithin(file.bytes, 140, 32);
        logo = {
          base64: Buffer.from(file.bytes).toString("base64"),
          extension,
          width: size.width,
          height: size.height,
        };
      }
    } catch {
      logo = null;
    }

    const now = new Date();
    const first = rows[0];
    const last = rows[rows.length - 1];
    const startDate = reportRangeDate(
      from,
      first ? new Date(first.checkInAt ?? first.checkOutAt ?? now) : now,
    );
    const endDate = reportRangeDate(
      to,
      last ? new Date(last.checkInAt ?? last.checkOutAt ?? now) : startDate,
    );
    const title = `Kunjungan Klien - ${headerDay(startDate, false)} - ${headerDay(endDate, true)}`;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Absensi";
    workbook.title = "Laporan Kunjungan Client";
    const sheet = workbook.addWorksheet("Kunjungan Client", {
      views: [{ state: "frozen", ySplit: 3 }],
    });
    sheet.columns = WIDTHS.map((width) => ({ width }));

    sheet.mergeCells("A1:L1");
    sheet.getCell("A1").value = title;
    sheet.getCell("A1").font = { name: "Calibri", size: 14, bold: true };
    sheet.getCell("A1").alignment = { horizontal: "left", vertical: "middle" };
    sheet.getRow(1).height = 30;

    sheet.mergeCells("A2:L2");
    sheet.getCell("A2").value = data.companyName;
    sheet.getCell("A2").font = {
      name: "Calibri",
      size: 14,
      bold: true,
      color: { argb: "FF333333" },
    };
    sheet.getCell("A2").alignment = { horizontal: "left", vertical: "middle" };
    sheet.getRow(2).height = 24;

    if (logo) {
      const imageId = workbook.addImage({
        base64: logo.base64,
        extension: logo.extension,
      });
      sheet.addImage(imageId, {
        tl: { col: 9, row: 1 },
        ext: { width: logo.width, height: logo.height },
      });
    }

    const headerRow = sheet.getRow(3);
    headerRow.height = 28;
    HEADERS.forEach((label, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = label;
      cell.font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF25A091" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = thinBorder("FF000000");
    });

    const addresses = await Promise.all(
      rows.map(async (row) => ({
        checkIn:
          row.checkInAddress ??
          (row.checkInLatitude !== null && row.checkInLongitude !== null
            ? await reverseGeocodeCoordinates(
                row.checkInLatitude,
                row.checkInLongitude,
              )
            : null),
        checkOut:
          row.checkOutAddress ??
          (row.checkOutLatitude !== null && row.checkOutLongitude !== null
            ? await reverseGeocodeCoordinates(
                row.checkOutLatitude,
                row.checkOutLongitude,
              )
            : null),
      })),
    );

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 4;
      const excelRow = sheet.getRow(rowNumber);
      excelRow.height = 24;
      const address = addresses[index];
      const values = [
        row.memberName,
        row.positionName ?? "-",
        row.clientName,
        row.checkInAt ? dateTimeLabel(row.checkInAt) : "",
        row.checkOutAt ? dateTimeLabel(row.checkOutAt) : "",
        durationLabel(row.checkInAt, row.checkOutAt),
        "",
        "",
        row.checkInNotes ?? "",
        row.checkOutNotes ?? "",
        locationLabel(
          address?.checkIn ?? null,
          row.checkInLatitude,
          row.checkInLongitude,
        ),
        locationLabel(
          address?.checkOut ?? null,
          row.checkOutLatitude,
          row.checkOutLongitude,
        ),
      ];
      values.forEach((value, cellIndex) => {
        const cell = excelRow.getCell(cellIndex + 1);
        cell.value = value;
        cell.font = { name: "Calibri", size: 11, bold: false };
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = thinBorder("FFD1D5DB");
      });

      const checkInPhoto = await readPhotoImage(row.checkInPhotoFileName);
      const checkOutPhoto = await readPhotoImage(row.checkOutPhotoFileName);
      if (checkInPhoto) {
        const imageId = workbook.addImage({
          base64: checkInPhoto.base64,
          extension: checkInPhoto.extension,
        });
        sheet.addImage(imageId, {
          tl: { col: 6, row: rowNumber - 1 },
          ext: { width: 80, height: 140 },
        });
      }
      if (checkOutPhoto) {
        const imageId = workbook.addImage({
          base64: checkOutPhoto.base64,
          extension: checkOutPhoto.extension,
        });
        sheet.addImage(imageId, {
          tl: { col: 7, row: rowNumber - 1 },
          ext: { width: 80, height: 140 },
        });
      }
      if (checkInPhoto || checkOutPhoto) excelRow.height = 150;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `kunjungan-client-${from ?? "awal"}-${to ?? "akhir"}.xlsx`;
    return new Response(buffer as ArrayBuffer, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
