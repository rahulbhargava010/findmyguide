import type { Config, Context } from '@netlify/functions';
import { withDatabaseContext } from '../../backend/database/database.mjs';
import { handleApiRequest } from '../../backend/routes/index.mjs';

class RequestAdapter {
  method: string;
  headers: Record<string, string>;
  #body: Uint8Array;

  constructor(request: Request, body: Uint8Array) {
    this.method = request.method;
    this.headers = Object.fromEntries([...request.headers].map(([key, value]) => [key.toLowerCase(), value]));
    this.#body = body;
  }

  async *[Symbol.asyncIterator]() {
    if (this.#body.length) yield this.#body;
  }
}

class ResponseAdapter {
  status = 200;
  headers = new Headers();
  headersSent = false;
  body = '';

  setHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  writeHead(status: number, headers: Record<string, string> = {}) {
    this.status = status;
    for (const [name, value] of Object.entries(headers)) this.headers.set(name, value);
    this.headersSent = true;
  }

  end(value: string | Uint8Array = '') {
    this.body = typeof value === 'string' ? value : new TextDecoder().decode(value);
    this.headersSent = true;
  }
}

export default async (request: Request, _context: Context) => {
  const requestBody = new Uint8Array(await request.arrayBuffer());
  const req = new RequestAdapter(request, requestBody);
  const res = new ResponseAdapter();
  const url = new URL(request.url);

  await withDatabaseContext(() => handleApiRequest(req, res, url));
  return new Response(res.body, { status: res.status, headers: res.headers });
};

export const config: Config = {
  path: '/api/*'
};

