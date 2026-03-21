import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const GET: APIRoute = async ({ params }) => {
  if (params.id == null) return new Response("Not found", { status: 404 });
  const db = env.DB;
  const row = await db
    .prepare("SELECT raw_xml, report_id FROM dmarc_reports WHERE report_id = ?")
    .bind(params.id)
    .first<{ raw_xml: string | null; report_id: string }>();

  if (row == null || row.raw_xml == null) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(row.raw_xml, {
    headers: {
      "Content-Type": "application/xml",
      "Content-Disposition": `attachment; filename="${row.report_id.replace(/[^\w\-.]/g, "_")}.xml"`,
    },
  });
};
