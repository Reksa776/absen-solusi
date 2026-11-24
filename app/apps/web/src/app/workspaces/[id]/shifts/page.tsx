import { redirect } from "next/navigation";

/** Alias lama untuk Jadwal Shift dialihkan ke Jadwal Hari Kerja. */
export default async function LegacyShiftsAliasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/workspaces/${id}/work-schedules`);
}
