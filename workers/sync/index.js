const SCORING = {
  r32: 1,
  r16: 2,
  qf: 4,
  sf: 8,
  final: 16,
  champion: 32,
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

  // Check rate limit headers
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
    'ROUND_OF_32': 'r32',
    'ROUND_OF_16': 'r16',
    'QUARTER_FINALS': 'qf',
    'SEMI_FINALS': 'sf',
    'FINAL': 'final',
  };
  return map[stage] || null;
}

async function syncResults(env) {
  const matches = await fetchMatches(env);
  if (!matches) return { synced: 0, error: 'Failed to fetch or rate limited' };

  // Only process knockout stage matches
  const knockout = matches.filter(m => mapRound(m.stage));
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

  // Recalculate all bracket scores
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
    const picks = JSON.parse(bracket.picks);
    let score = 0;

    for (const match of matches) {
      const round = match.round;
      const winner = match.winner_id;
      const points = SCORING[round] || 0;

      // Check if user picked the correct winner for this match
      const userPick = picks[match.id];
      if (userPick && userPick === winner) {
        score += points;
      }

      // Bonus points for champion
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
