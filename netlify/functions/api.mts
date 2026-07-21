import type { Config, Context } from '@netlify/functions';
import { getDeployStore, getStore } from '@netlify/blobs';

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
    if (this.#body.length) yield new TextDecoder().decode(this.#body);
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

async function processRequest(request: Request, context: Context) {
  const store = context.deploy.context === 'production'
    ? getStore('findmyguide-data', { consistency: 'strong' })
    : getDeployStore('findmyguide-data');
  const snapshot = await store.get('database.sqlite', { type: 'arrayBuffer' });
  const database = await import('../../backend/database/database.mjs');
  await database.loadDatabaseSnapshot(snapshot);
  const { handleApiRequest } = await import('../../backend/routes/index.mjs');
  const requestBody = new Uint8Array(await request.arrayBuffer());
  const req = new RequestAdapter(request, requestBody);
  const res = new ResponseAdapter();
  const url = new URL(request.url);

  try {
    await database.withDatabaseContext(() => handleApiRequest(req, res, url));
  } finally {
    await store.set('database.sqlite', await database.createDatabaseSnapshot());
  }
  return new Response(res.body, { status: res.status, headers: res.headers });
}

let requestQueue = Promise.resolve<Response>(new Response());

export default (request: Request, context: Context) => {
  const result = requestQueue.then(() => processRequest(request, context));
  requestQueue = result.catch(() => new Response());
  return result;
};

export const config: Config = {
  path: '/api/*'
};
