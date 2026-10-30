import { privateHeaders } from "../../../lib/beta/http";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ status: "alive" }, { headers: privateHeaders });
}
