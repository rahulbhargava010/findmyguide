import { AsyncLocalStorage } from 'node:async_hooks';
import { getDatabase } from '@netlify/database';

const database = getDatabase();
const requestStorage = new AsyncLocalStorage();

function translateSql(source) {
  let parameter = 0;
  return String(source)
    .replace(/datetime\('now','\+7 days'\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '7 days')")
    .replace(/datetime\('now','\+24 hours'\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '24 hours')")
    .replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\?/g, () => `$${++parameter}`);
}

function deferred(promise) {
  const callable = () => {};
  return new Proxy(callable, {
    get(_target, property) {
      if (property === 'then') return promise.then.bind(promise);
      if (property === 'catch') return promise.catch.bind(promise);
      if (property === 'finally') return promise.finally.bind(promise);
      return deferred(promise.then(value => {
        const member = value?.[property];
        return typeof member === 'function' ? member.bind(value) : member;
      }));
    },
    apply(_target, _thisArg, argumentsList) {
      return deferred(promise.then(fn => fn(...argumentsList)));
    }
  });
}

async function query(sql, parameters) {
  const state = requestStorage.getStore();
  const runner = state?.client || database.pool;
  return runner.query(translateSql(sql), parameters);
}

function prepare(sql) {
  return {
    get(...parameters) {
      return deferred(query(sql, parameters).then(result => result.rows[0] || undefined));
    },
    all(...parameters) {
      return deferred(query(sql, parameters).then(result => result.rows));
    },
    run(...parameters) {
      const statement = /^\s*insert\b/i.test(sql) && !/\breturning\b/i.test(sql)
        ? `${sql} RETURNING *`
        : sql;
      return deferred(query(statement, parameters).then(result => ({
        changes: result.rowCount,
        lastInsertRowid: result.rows[0]?.id ?? result.rows[0]?.user_id ?? result.rows[0]?.booking_id
      })));
    }
  };
}

async function exec(command) {
  const normalized = String(command).trim().toUpperCase();
  const state = requestStorage.getStore();
  if (!state) throw new Error('Database operation must run inside a request context');

  if (normalized === 'BEGIN') {
    state.client = await database.pool.connect();
    await state.client.query('BEGIN');
    return;
  }

  if (normalized === 'COMMIT' || normalized === 'ROLLBACK') {
    if (!state.client) return;
    try {
      await state.client.query(normalized);
    } finally {
      state.client.release();
      state.client = null;
    }
    return;
  }

  await query(command, []);
}

export const db = { prepare, exec };
export const withDatabaseContext = work => requestStorage.run({}, work);
