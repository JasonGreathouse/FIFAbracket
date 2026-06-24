CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  flag TEXT NOT NULL,
  group_letter TEXT NOT NULL
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  round TEXT NOT NULL,
  team1_id TEXT,
  team2_id TEXT,
  winner_id TEXT,
  match_date TEXT,
  status TEXT DEFAULT 'upcoming',
  FOREIGN KEY (team1_id) REFERENCES teams(id),
  FOREIGN KEY (team2_id) REFERENCES teams(id),
  FOREIGN KEY (winner_id) REFERENCES teams(id)
);

CREATE TABLE brackets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  picks TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE score_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bracket_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  FOREIGN KEY (bracket_id) REFERENCES brackets(id),
  FOREIGN KEY (match_id) REFERENCES matches(id)
);
