import { NextResponse } from 'next/server';
import { applyAshby, type ApplyPayload } from '@/scripts/applyAshby';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ApplyPayload;
    const result = await applyAshby(payload);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
