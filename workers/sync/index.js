const SCORING = {
  r32: 10,
  r16: 20,
  qf: 40,
  sf: 80,
  final: 160,
  champion: 320,
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchMatches(env) {
  const res = await fetch(
    'https://api.football-data.org/v4/competitions/WC/matches?season=2026',
    {
      headers: { 'X-Auth-Token': env.FOOTBALL_DATA_KEY },
    }
  );

  const remainingRequests = res.headers.get('X-Requests-Available-Minute');
  if (remainingRequests && parseInt(remainingRequests) < 2) {
    console.log('Rate limit close, backing off');
    return null;
  }

  if (!res.ok) {
    console.error('football-data.org error:', res.status);
    return null;
  }

  const data = await res.json();
  return data.matches;
}

function mapRound(stage) {
  const map = {
    'LAST_32': 'r32',
    'LAST_16': 'r16',
    'QUARTER_FINALS': 'qf',
    'SEMI_FINALS': 'sf',
    'FINAL': 'final',
  };
  return map[stage] || null;
}


async function syncResults(env) {
  const matches = await fetchMatches(env);
  if (!matches) return { synced: 0, error: 'Failed to fetch or rate limited' };
  
  const knockout = matches.filter(m => mapRound(m.stage));
console.log('Stages found:', [...new Set(matches.map(m => m.stage))]);
console.log('Knockout count:', knockout.length);
  let synced = 0;

  for (const match of knockout) {
    const round = mapRound(match.stage);
    const status = match.status;
    const winner =
      status === 'FINISHED'
        ? match.score.winner === 'HOME_TEAM'
          ? match.homeTeam.tla
          : match.score.winner === 'AWAY_TEAM'
          ? match.awayTeam.tla
          : null
        : null;
        console.log(`Match ${match.id}: status=${status}, score.winner=${match.score?.winner}, tla_winner=${winner}`);

    await env.DB.prepare(`
      INSERT INTO matches (id, round, team1_id, team2_id, winner_id, match_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        winner_id = excluded.winner_id,
        status = excluded.status
    `)
      .bind(
        String(match.id),
        round,
        match.homeTeam.tla || null,
        match.awayTeam.tla || null,
        winner,
        match.utcDate,
        status
      )
      .run();

    synced++;
  }

  await recalculateScores(env);

  return { synced, total: knockout.length };
}

async function recalculateScores(env) {
  const { results: brackets } = await env.DB.prepare(
    'SELECT id, picks FROM brackets'
  ).all();

  const { results: matches } = await env.DB.prepare(
    'SELECT * FROM matches WHERE winner_id IS NOT NULL'
  ).all();

  for (const bracket of brackets) {
    let picks;
    try {
      picks = JSON.parse(bracket.picks);
    } catch(e) {
      console.error('Bad picks JSON for bracket', bracket.id);
      continue;
    }

    let score = 0;
    const r32Slots = picks.r32_slots || {};

    for (const match of matches) {
      const round = match.round;
      const winner = match.winner_id;
      const points = SCORING[round] || 0;

      if (round === 'r32') {
        // Find which match number in r32_slots corresponds to this real match
        // by matching both teams regardless of home/away order
        let matchNum = null;
        for (const [key, slot] of Object.entries(r32Slots)) {
          if (
            (slot.team1 === match.team1_id && slot.team2 === match.team2_id) ||
            (slot.team1 === match.team2_id && slot.team2 === match.team1_id)
          ) {
            matchNum = key; // e.g. "match3"
            break;
          }
        }
        if (matchNum && picks.r32[matchNum] === winner) {
          score += points;
        }
      } else {
        // For r16/qf/sf/final, match by round picks
        // Walk all picks for this round and check if any match the winner
        const roundPicks = picks[round] || {};
        for (const pick of Object.values(roundPicks)) {
          if (pick === winner) {
            score += points;
            break;
          }
        }
      }

      // Champion bonus — awarded on top of final points
      if (round === 'final' && picks.champion === winner) {
        score += SCORING.champion;
      }
    }

    await env.DB.prepare(
      'UPDATE brackets SET score = ? WHERE id = ?'
    ).bind(score, bracket.id).run();
  }
}

export default {
  // HTTP trigger — manual sync via POST /sync
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (method === 'POST' && url.pathname === '/sync') {
      const result = await syncResults(env);
      return json(result);
    }

    if (method === 'GET' && url.pathname === '/sync/status') {
      const { results } = await env.DB.prepare(
        'SELECT COUNT(*) as total, SUM(CASE WHEN winner_id IS NOT NULL THEN 1 ELSE 0 END) as completed FROM matches'
      ).all();
      return json(results[0]);
    }

    return json({ error: 'Not found' }, 404);
  },

  // Cron trigger — runs automatically every 2 hours during tournament
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncResults(env));
  },
};
