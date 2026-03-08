#!/usr/bin/env node
// test-pipeline.mjs — simulates upstream pipeline sending scene updates
// Run the music engine first: npx ts-node music-engine/index.ts
// Then in another terminal: node test-pipeline.mjs

const BASE_URL = `http://localhost:${process.env.MUSIC_ENGINE_PORT ?? 3001}`

let stepIndex = 0

async function post(scene) {
  stepIndex++
  const label = `[step ${stepIndex}]`
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${label} POST /update`)
  console.log(`  vibe:          "${scene.vibe}"`)
  console.log(`  visible_users: [${scene.visible_users.join(', ')}]`)

  const res = await fetch(`${BASE_URL}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scene),
  })
  const json = await res.json()
  console.log(`  response:      ${JSON.stringify(json)} (HTTP ${res.status})`)
  if (!json.ok) process.exit(1)
}

function wait(ms, label) {
  console.log(`\n... waiting ${ms / 1000}s${label ? ` (${label})` : ''} ...`)
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForEngine() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`)
      if (res.ok) { console.log('[test-pipeline] engine is up'); return }
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  console.error('[test-pipeline] engine did not start in time')
  process.exit(1)
}

async function main() {
  console.log(`[test-pipeline] connecting to ${BASE_URL}`)
  await waitForEngine()

  // 1. Initial scene — two users, calm vibe
  await post({ vibe: 'calm cafe afternoon', visible_users: ['user_13', 'user_42'] })
  await wait(8000, 'let opening music establish')

  // 2. New user enters — vibe unchanged
  await post({ vibe: 'calm cafe afternoon', visible_users: ['user_13', 'user_42', 'user_77'] })
  await wait(7000, 'let entering motif play')

  // 3. A user leaves — vibe unchanged
  await post({ vibe: 'calm cafe afternoon', visible_users: ['user_13', 'user_77'] })
  await wait(7000, 'let exit motif fade')

  // 4. Vibe shifts — same users
  await post({ vibe: 'busy crowded hallway', visible_users: ['user_13', 'user_77'] })
  await wait(10000, 'let vibe crossfade play out')

  // 5. Vibe shifts again + user leaves simultaneously
  await post({ vibe: 'quiet library', visible_users: ['user_13'] })
  await wait(10000, 'let vibe transition + exit motif')

  // 6. All users leave
  await post({ vibe: 'quiet library', visible_users: [] })
  await wait(6000, 'let scene go quiet')

  // 7. New person enters into quiet scene
  await post({ vibe: 'quiet library', visible_users: ['user_42'] })
  await wait(7000, 'let entering motif play in quiet scene')

  console.log(`\n${'─'.repeat(60)}`)
  console.log('[test-pipeline] sequence complete')
}

main().catch(err => { console.error(err); process.exit(1) })
