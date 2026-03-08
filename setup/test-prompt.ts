import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
config({ path: path.resolve(__dirname, '../.env.local') })

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { buildLyriaPrompt } from '../music-engine/prompt-builder.js'
import type { PersonMotif } from '../music-engine/types.js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const input = JSON.parse(
  readFileSync(path.resolve(__dirname, '../test.json'), 'utf-8')
) as { vibe: string; visible_users: string[] }

console.log('\n--- test.json ---')
console.log(JSON.stringify(input, null, 2))

const { data, error } = await supabaseAdmin
  .from('person_motif_prompts')
  .select('*')
  .in('user_id', input.visible_users)

if (error) {
  console.error('\nSupabase error:', error.message)
  process.exit(1)
}

const motifs = data as PersonMotif[]

console.log(`\n--- Supabase: found ${motifs.length}/${input.visible_users.length} users ---`)
for (const m of motifs) {
  console.log(`  ${m.user_id} → ${m.name}: ${m.motif_prompt}`)
}

const missing = input.visible_users.filter(id => !motifs.find(m => m.user_id === id))
if (missing.length) {
  console.warn('\nWarning: no motif found for:', missing.join(', '))
}

const prompt = buildLyriaPrompt({
  vibe: input.vibe,
  motifs,
  previousState: null,
  entering: input.visible_users,
  leaving: [],
})

console.log('\n--- Built Lyria Prompt ---')
console.log(prompt)
