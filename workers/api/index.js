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

function generateId(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < length; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // GET /teams — return all 32 teams
    if (method === 'GET' && path === '/teams') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM teams ORDER BY group_letter, id'
      ).all();
      return json(results);
    }

    // GET /teams/:group — teams by group letter
    if (method === 'GET' && path.startsWith('/teams/')) {
      const group = path.split('/')[2].toUpperCase();
      const { results } = await env.DB.prepare(
        'SELECT * FROM teams WHERE group_letter = ?'
      ).bind(group).all();
      return json(results);
    }

    // POST /bracket — save a new bracket
    if (method === 'POST' && path === '/bracket') {
      const body = await request.json();
      const { name, picks } = body;

      if (!name || !picks) {
        return json({ error: 'name and picks are required' }, 400);
      }

      const existing = await env.DB.prepare(
        'SELECT id FROM brackets WHERE LOWER(name) = LOWER(?)'
      ).bind(name).first();

      if (existing) {
        return json({ error: 'Name already taken, please choose a different one' }, 409);
      }

      const id = generateId();

      await env.DB.prepare(
        'INSERT INTO brackets (id, name, picks, score) VALUES (?, ?, ?, 0)'
      ).bind(id, name, JSON.stringify(picks)).run();

      return json({ id, name, url: `/view.html?id=${id}` });
    }

    // GET /bracket/:id — load a specific bracket
    if (method === 'GET' && path.startsWith('/bracket/')) {
      const id = path.split('/')[2];
      const bracket = await env.DB.prepare(
        'SELECT * FROM brackets WHERE id = ?'
      ).bind(id).first();

      if (!bracket) return json({ error: 'Bracket not found' }, 404);

      bracket.picks = JSON.parse(bracket.picks);
      return json(bracket);
    }

    // GET /leaderboard — all brackets ranked by score
    if (method === 'GET' && path === '/leaderboard') {
      const { results } = await env.DB.prepare(
        'SELECT id, name, score, created_at FROM brackets ORDER BY score DESC, created_at ASC'
      ).all();
      return json(results);
    }

    // GET /results — current official match results
    if (method === 'GET' && path === '/results') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM matches ORDER BY match_date ASC'
      ).all();
      return json(results);
    }
// GET /today - today's World Cup matches from football-data.org
if (method === 'GET' && path === '/today') {
  const today = new Date().toISOString().split('T')[0];
  
  
  try {
    const res = await fetch(
      `https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${today}&dateTo=${today}`,
      { headers: { 'X-Auth-Token': env.FOOTBALL_DATA_KEY } }
    );

    const remaining = res.headers.get('X-Requests-Available-Minute');
    if (remaining && parseInt(remaining) < 2) {
      return json({ error: 'Rate limited, try again shortly' }, 429);
    }

    if (!res.ok) {
      return json({ error: 'Failed to fetch matches' }, 502);
    }

    const data = await res.json();
    const matches = data.matches.map(m => ({
      id: m.id,
      status: m.status,
      minute: m.minute || null,
      homeTeam: m.homeTeam.name,
      homeTla: m.homeTeam.tla,
      awayTeam: m.awayTeam.name,
      awayTla: m.awayTeam.tla,
      homeScore: m.score.fullTime.home,
      awayScore: m.score.fullTime.away,
      halfTimeHome: m.score.halfTime.home,
      halfTimeAway: m.score.halfTime.away,
      utcDate: m.utcDate,
      venue: m.venue || null,
      winner: m.score.winner || null
    }));

    return json({ date: today, matches });
  } catch(err) {
    return json({ error: 'Internal error', detail: err.message }, 500);
  }
}
    return json({ error: 'Not found' }, 404);
  }
};
