import { redirect } from "next/navigation";

/** Route Jadwal Shift lama dipertahankan sebagai redirect, bukan halaman aktif. */
export default async function LegacyShiftsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/workspaces/${id}/work-schedules`);
}
