// D1 helpers.

export async function one(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).first();
}

export async function all(env, sql, ...params) {
  const r = await env.DB.prepare(sql).bind(...params).all();
  return r.results || [];
}

export async function run(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).run();
}

export async function batch(env, statements) {
  return env.DB.batch(statements.map(([sql, ...p]) => env.DB.prepare(sql).bind(...p)));
}
