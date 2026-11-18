import { currentUser } from "@/lib/auth";
import { apiFailure } from "@/lib/api";

export const dynamic = "force-dynamic";

// A separate round trip verifies that the browser actually stored and sent the cookie.
export async function GET() {
  try {
    const user = await currentUser();
    return Response.json({ userId: user?.id ?? null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiFailure(error); }
}
