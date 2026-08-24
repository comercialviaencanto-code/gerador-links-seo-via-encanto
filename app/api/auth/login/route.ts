import { NextResponse } from "next/server";
import {
  createSessionCookieValue,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "../../../../lib/session";

function timingSafeEqualText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(request: Request): Promise<NextResponse> {
  const expectedPassword = process.env.UPLOAD_API_TOKEN?.trim();
  if (!expectedPassword) {
    return NextResponse.json(
      { success: false, error: "UPLOAD_API_TOKEN não está configurado no servidor." },
      { status: 500 },
    );
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: string };
    password = (body.password ?? "").trim();
  } catch {
    return NextResponse.json(
      { success: false, error: "Envie a senha em JSON." },
      { status: 400 },
    );
  }

  if (!password || !timingSafeEqualText(password, expectedPassword)) {
    return NextResponse.json(
      { success: false, error: "Senha incorreta." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, await createSessionCookieValue(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
