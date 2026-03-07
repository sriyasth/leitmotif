import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://jzaihdtewcepcldmrinm.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6YWloZHRld2NlcGNsZG1yaW5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg5MDExOSwiZXhwIjoyMDg4NDY2MTE5fQ._WATbqZFL8zKEejumimLyyVvumCxS-KpPzrHLRw_vDA";

// Try multiple connection strings
const DB_URLS = [
  "postgresql://postgres.jzaihdtewcepcldmrinm:6Gnba3hS8MLXbqLL@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
  "postgresql://postgres.jzaihdtewcepcldmrinm:6Gnba3hS8MLXbqLL@aws-0-us-west-1.pooler.supabase.com:5432/postgres",
  "postgresql://postgres.jzaihdtewcepcldmrinm:6Gnba3hS8MLXbqLL@aws-0-us-east-2.pooler.supabase.com:5432/postgres",
];

const headers = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
};

// Step 1: Run migration SQL via pg (try multiple endpoints)
async function runMigration() {
  console.log("--- Step 1: Running SQL migration ---");
  const sql = readFileSync(join(__dirname, "migration_person_events.sql"), "utf8");

  for (const url of DB_URLS) {
    try {
      console.log(`  Trying ${new URL(url).host}...`);
      const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
      await client.connect();
      await client.query(sql);
      console.log("  Tables created successfully.");
      await client.end();
      return;
    } catch (err) {
      console.log(`  Failed: ${err.message}`);
    }
  }
  throw new Error("Could not connect to database via any endpoint. Please run migration SQL manually in Supabase dashboard.");
}

// Step 2: Parse test output file
function parseEvents() {
  const txt = readFileSync(
    join(__dirname, "..", "testvideos", "vision_validation_output_adaface.txt"),
    "utf8"
  );
  const lines = txt.split("\n");
  const events = [];
  const eventLineRe =
    /^ts=(\S+)\s+event=(\S+)\s+track=(\S+)\s+user_type=(\S+)\s+user_id=(\S+)\s+source=(\S+)\s+conf=(\S+)\s+bearing=(\S+)\s+distance=(\S+)\s+top1=(\S+)\s+top2=(\S+)\s+margin=(\S+)/;

  for (const line of lines) {
    const m = line.match(eventLineRe);
    if (!m) continue;
    const tsMs = Math.round(new Date(m[1]).getTime());
    events.push({
      track_id: m[3],
      event_type: m[2],
      user_type: m[4],
      user_id: m[5],
      source: m[6],
      confidence: parseFloat(m[7]),
      bearing: parseFloat(m[8]),
      distance_proxy: parseFloat(m[9]),
      similarity_top1: parseFloat(m[10]),
      similarity_top2: parseFloat(m[11]),
      margin: parseFloat(m[12]),
      timestamp_ms: tsMs,
    });
  }
  console.log(`Parsed ${events.length} events from test output.`);
  return events;
}

// Step 3: Replay events via REST
async function replayEvents(events) {
  console.log("\n--- Step 3: Replaying events to Supabase ---");
  let inserted = 0;

  for (const ev of events) {
    // Insert person_event
    const evRes = await fetch(`${SUPABASE_URL}/rest/v1/person_events`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(ev),
    });
    if (!evRes.ok) {
      console.error(`  person_events insert failed: ${evRes.status} ${await evRes.text()}`);
      continue;
    }

    // Upsert person
    await fetch(`${SUPABASE_URL}/rest/v1/persons?on_conflict=user_id`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: ev.user_id,
        user_type: ev.user_type,
        last_seen_at: new Date().toISOString(),
        last_confidence: ev.confidence,
      }),
    });

    // Sync visible_users
    // On person_entered, clear previous identity for this track
    if (ev.event_type === "person_entered") {
      await fetch(
        `${SUPABASE_URL}/rest/v1/visible_users?track_id=eq.${ev.track_id}`,
        { method: "DELETE", headers }
      );
    }
    if (ev.event_type === "person_left") {
      await fetch(
        `${SUPABASE_URL}/rest/v1/visible_users?user_id=eq.${ev.user_id}`,
        { method: "DELETE", headers }
      );
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/visible_users?on_conflict=user_id`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          user_id: ev.user_id,
          user_type: ev.user_type,
          track_id: ev.track_id,
          confidence: ev.confidence,
          bearing: ev.bearing,
          distance_proxy: ev.distance_proxy,
          updated_at: new Date().toISOString(),
        }),
      });
    }

    inserted++;
  }
  console.log(`Replayed ${inserted} events.`);
}

// Step 4: Query and print results
async function queryResults() {
  console.log("\n--- Step 4: Querying results ---");

  for (const table of ["person_events", "persons", "visible_users"]) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=5`, {
      headers: { ...headers, Accept: "application/json" },
    });
    const countRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: { ...headers, Accept: "application/json", Prefer: "count=exact" },
    });
    const count = countRes.headers.get("content-range")?.split("/")[1] || "?";
    const rows = await res.json();
    console.log(`\n${table}: ${count} rows`);
    if (rows.length > 0) {
      console.table(
        rows.map((r) => {
          const { id, created_at, first_seen_at, entered_at, ...rest } = r;
          return rest;
        })
      );
    }
  }

  // Final visible_users check
  const visRes = await fetch(`${SUPABASE_URL}/rest/v1/visible_users?select=user_id`, {
    headers: { ...headers, Accept: "application/json" },
  });
  const visible = await visRes.json();
  console.log(`\nFinal visible_users (should be empty): ${JSON.stringify(visible)}`);
}

async function main() {
  // Migration already run manually in Supabase dashboard
  const events = parseEvents();
  await replayEvents(events);
  await queryResults();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
