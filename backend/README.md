# Backend

- `server.mjs` starts the HTTP server and serves `frontend/public`.
- `database/database.mjs` owns SQLite schema migration, seed data, password hashing, and the database connection.
- `routes/context.mjs` contains shared request/session/response helpers.
- `routes/index.mjs` registers the role-protected API endpoints.
- `tests/api.test.mjs` runs the complete API workflow against an isolated temporary database.

Run the backend through the root package scripts:

```bash
npm run dev
npm test
```
