import ExcelJS from "exceljs";

import {
  fitImageWithin,
  getAttendancePeriodSummary,
  getClientIp,
  readCompanyLogo,
  recordAttendancePeriodXlsxExport,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = [
  "Nama Karyawan",
  "Jabatan",
  "Pola Kerja",
  "Total Hari Jadwal Kerja",
  "Total Hari Kehadiran",
  "Total Hari Tidak Masuk",
  "WFH",
  "WFC",
  "Cuti",
  "Izin / Sakit",
  "Alpa",
  "Persentase Kehadiran",
] as const;
const WIDTHS = [28, 26, 42, 22, 22, 22, 10, 10, 10, 14, 10, 22] as const;
const COLUMN_COUNT = HEADERS.length;

function dateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(parsed)
    .replace(/\./g, "");
}

function thinBorder(argb: string): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb } };
  return { top: side, left: side, bottom: side, right: side };
}

type EmbeddedImage = {
  base64: string;
  extension: "jpeg" | "png";
  width: number;
  height: number;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    const url = new URL(request.url);
    const summary = await getAttendancePeriodSummary({
      ctx,
      workspaceId: id,
      startDate: url.searchParams.get("startDate") ?? "",
      endDate: url.searchParams.get("endDate") ?? "",
      memberId: url.searchParams.get("memberId") || undefined,
    });

    let logo: EmbeddedImage | null = null;
    try {
      const file = await readCompanyLogo({ ctx, workspaceId: id });
      const extension =
        file.contentType === "image/png"
          ? "png"
          : file.contentType === "image/jpeg"
            ? "jpeg"
            : null;
      // ExcelJS tidak menulis WebP; logo WebP dilewati dengan aman.
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

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Absensi";
    workbook.title = "Ringkasan Kehadiran";
    const sheet = workbook.addWorksheet("Ringkasan Kehadiran");
    sheet.columns = WIDTHS.map((width) => ({ width }));

    sheet.mergeCells("A1:L1");
    sheet.getCell("A1").value = `Ringkasan Kehadiran - ${dateLabel(summary.startDate)} - ${dateLabel(summary.endDate)}`;
    sheet.getCell("A1").font = { name: "Calibri", size: 12, bold: true };
    sheet.getCell("A1").alignment = { horizontal: "left", vertical: "middle" };
    sheet.getRow(1).height = 28;

    sheet.mergeCells("A2:L2");
    sheet.getCell("A2").value = summary.companyName;
    sheet.getCell("A2").font = {
      name: "Calibri",
      size: 12,
      bold: true,
      color: { argb: "FF1F2937" },
    };
    sheet.getCell("A2").alignment = { horizontal: "left", vertical: "middle" };
    sheet.getRow(2).height = 34;

    if (logo) {
      const imageId = workbook.addImage({
        base64: logo.base64,
        extension: logo.extension,
      });
      sheet.addImage(imageId, {
        tl: { col: 1.5, row: 1.1 },
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
        size: 10,
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F8E8B" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = thinBorder("FF166F6D");
    });

    summary.members.forEach((member, index) => {
      const row = sheet.getRow(index + 4);
      row.height = 21;
      const scheduledDays = member.scheduledDays;
      const presentDays = member.presentDays;
      const values = [
        member.name,
        member.positionName ?? "-",
        member.workPatternLabel ?? "-",
        scheduledDays,
        presentDays,
        Math.max(0, scheduledDays - presentDays),
        member.wfhDays,
        member.wfcDays,
        member.leaveDays,
        member.permitDays,
        member.absentDays,
        scheduledDays > 0 ? presentDays / scheduledDays : 0,
      ];
      values.forEach((value, cellIndex) => {
        const cell = row.getCell(cellIndex + 1);
        cell.value = value;
        cell.font = { name: "Calibri", size: 10, bold: false };
        cell.alignment = {
          horizontal: cellIndex < 3 ? "left" : "right",
          vertical: "middle",
          wrapText: false,
        };
        cell.border = thinBorder("FFD1D5DB");
        if (cellIndex === COLUMN_COUNT - 1) cell.numFmt = "0%";
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    await recordAttendancePeriodXlsxExport({
      ctx,
      workspaceId: id,
      startDate: summary.startDate,
      endDate: summary.endDate,
      rowCount: summary.members.length,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    const filename = `Ringkasan-Kehadiran-${summary.startDate}-sd-${summary.endDate}.xlsx`;
    return new Response(buffer as ArrayBuffer, {
      status: 200,
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
