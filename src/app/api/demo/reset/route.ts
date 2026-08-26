import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Demo reset is disabled in production." },
      { status: 403 }
    );
  }

  const requiredToken = process.env.DEMO_RESET_TOKEN;
  if (requiredToken && request.headers.get("x-demo-reset-token") !== requiredToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    await execAsync("npm run db:seed", {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: 120_000,
    });
    return NextResponse.json({ ok: true, message: "Demo data reseeded." });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Reseed script failed.",
      },
      { status: 500 }
    );
  }
}
