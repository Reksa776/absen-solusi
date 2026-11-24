import ExcelJS from "exceljs";

import {
  listWorkspaceClientVisitExportRows,
  requirePermission,
} from "@absensi/auth";

import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JAKARTA = "Asia/Jakarta";

function parts(value: string): Record<string, string> {
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

function reportDate(value: string): string {
  const p = parts(value);
  return `${p.year}-${p.month}-${p.day}`;
}

function reportTime(value: string): string {
  const p = parts(value);
  return `${p.hour}:${p.minute}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermission(request, "attendance.read");
    const { id } = await context.params;
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const rows = await listWorkspaceClientVisitExportRows({
      ctx,
      workspaceId: id,
      from,
      to,
      memberId: url.searchParams.get("memberId") ?? undefined,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Absensi";
    workbook.title = "Laporan Kunjungan Client";
    const sheet = workbook.addWorksheet("Kunjungan Client", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "No", key: "no", width: 6 },
      { header: "Tanggal", key: "date", width: 13 },
      { header: "Jam Kunjungan", key: "time", width: 14 },
      { header: "Nama Karyawan", key: "member", width: 24 },
      { header: "Divisi", key: "division", width: 20 },
      { header: "Nama Client", key: "client", width: 28 },
      { header: "Koordinat GPS (Lat, Lng)", key: "coordinates", width: 28 },
      { header: "Link Google Maps", key: "maps", width: 34 },
      { header: "Keterangan", key: "notes", width: 36 },
      { header: "URL Lampiran Foto", key: "photo", width: 42 },
    ];
    sheet.getRow(1).height = 25;
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF15803D" },
      };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFE2E8E4" } },
      };
    });

    const origin = new URL(request.url).origin;
    rows.forEach((row, index) => {
      const mapsUrl = `https://www.google.com/maps?q=${row.latitude},${row.longitude}`;
      const photoUrl = row.hasPhoto
        ? `${origin}/api/workspaces/${id}/client-visits/logs/${row.id}/photo`
        : "";
      const values = [
        index + 1,
        reportDate(row.timestampServer),
        reportTime(row.timestampServer),
        row.memberName,
        row.divisionName ?? "Tanpa divisi",
        row.clientName,
        `${row.latitude.toFixed(6)}, ${row.longitude.toFixed(6)}`,
        "",
        row.notes ?? "",
        "",
      ];
      const excelRow = sheet.addRow(values);
      excelRow.getCell(8).value = {
        text: mapsUrl,
        hyperlink: mapsUrl,
      };
      excelRow.getCell(8).font = { color: { argb: "FF15803D" }, underline: true };
      if (photoUrl) {
        excelRow.getCell(10).value = {
          text: photoUrl,
          hyperlink: photoUrl,
        };
        excelRow.getCell(10).font = { color: { argb: "FF15803D" }, underline: true };
      }
      excelRow.eachCell((cell) => {
        cell.alignment = { vertical: "top", wrapText: true };
        cell.border = {
          bottom: { style: "hair", color: { argb: "FFE2E8E4" } },
        };
      });
    });

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 10 },
    };
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
