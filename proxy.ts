import { NextResponse, type NextRequest } from "next/server";
import { betaAccess } from "./lib/beta/access";

export function proxy(request: NextRequest) {
  // Liveness contains only a constant status. Readiness and all shopping routes
  // require beta access. Static assets contain no privileged configuration.
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();
  return betaAccess(request) ?? NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
