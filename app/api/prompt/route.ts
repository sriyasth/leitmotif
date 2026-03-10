import { NextRequest, NextResponse } from 'next/server'
import { runContextEngine } from '@/lib/context-engine'
import type { MusicState } from '@/lib/types'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const { vibe, environment, visible_users, previousState } = await req.json() as {
      vibe: string
      environment: string
      visible_users: string[]
      previousState: MusicState | null
    }

    const result = await runContextEngine(
      { vibe, environment, visible_users },
      previousState
    )

    return NextResponse.json(result)
  } catch (err) {
    console.error('[API/prompt] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
