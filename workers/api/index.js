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

    return json({ error: 'Not found' }, 404);
  }
};
