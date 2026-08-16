const http = require('http');
const { PassThrough } = require('stream');

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

function toLowerCaseHeaders(headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function getHeader(headers, name) {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  if (lower in headers) return headers[lower];
  if (name in headers) return headers[name];
  return undefined;
}

function parseBody(text, headers) {
  if (text === undefined || text === null) return '';
  const contentType = getHeader(headers, 'content-type');
  if (typeof contentType === 'string' && contentType.includes('application/json')) {
    try {
      return text.length ? JSON.parse(text) : {};
    } catch (error) {
      return text;
    }
  }
  return text;
}

function createRequest(app, { method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const requestSocket = new PassThrough();
    const responseSocket = new PassThrough();

    const req = new http.IncomingMessage(requestSocket);
    req.url = path;
    req.method = method;
    req.headers = toLowerCaseHeaders(headers);
    req.connection = requestSocket;
    req.socket = requestSocket;
    requestSocket.setTimeout = () => {};
    requestSocket.destroy = () => {};

    const res = new http.ServerResponse(req);
    const chunks = [];

    responseSocket.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    responseSocket.on('error', reject);
    res.on('error', reject);

    res.on('finish', () => {
      responseSocket.end();
      const buffer = Buffer.concat(chunks);
      const rawText = buffer.toString();
      const separatorIndex = rawText.indexOf('\r\n\r\n');
      const bodyText = separatorIndex >= 0 ? rawText.slice(separatorIndex + 4) : rawText;
      const headers = toLowerCaseHeaders(res.getHeaders());
      resolve({
        status: res.statusCode,
        statusCode: res.statusCode,
        headers,
        body: parseBody(bodyText, headers),
        text: bodyText,
        ok: res.statusCode >= 200 && res.statusCode < 300
      });
    });

    res.assignSocket(responseSocket);

    try {
      if (body === undefined) {
        requestSocket.end();
      } else if (Buffer.isBuffer(body) || typeof body === 'string') {
        requestSocket.end(body);
      } else {
        const json = JSON.stringify(body);
        if (!req.headers['content-type']) {
          req.headers['content-type'] = 'application/json';
        }
        req.body = body;
        requestSocket.end(json);
      }
      app.handle(req, res);
    } catch (error) {
      reject(error);
    }
  });
}

class Test {
  constructor(app, method, path, agent) {
    this.app = app;
    this.method = method;
    this.path = path;
    this.agent = agent || null;
    this._headers = {};
    this._body = undefined;
    this._expects = [];
    this._timeout = null;
    this._promise = null;
  }

  set(field, value) {
    if (typeof field === 'object') {
      Object.entries(field).forEach(([key, val]) => {
        this._headers[key.toLowerCase()] = val;
      });
    } else {
      this._headers[field.toLowerCase()] = value;
    }
    return this;
  }

  send(body) {
    this._body = body;
    return this;
  }

  timeout(ms) {
    this._timeout = ms;
    return this;
  }

  expect(a, b) {
    if (typeof a === 'number' && b === undefined) {
      this._expects.push({ type: 'status', value: a });
    } else if (typeof a === 'string' && b !== undefined) {
      this._expects.push({ type: 'header', field: a, value: b });
    } else if (typeof a === 'function') {
      this._expects.push({ type: 'custom', handler: a });
    } else {
      this._expects.push({ type: 'body', value: a, second: b });
    }
    return this;
  }

  then(onFulfilled, onRejected) {
    return this._execute().then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return this._execute().catch(onRejected);
  }

  _applyAgentHeaders(headers) {
    if (!this.agent) return headers;
    const cookieHeader = this.agent._getCookieHeader();
    if (cookieHeader) {
      const existing = headers['cookie'];
      headers['cookie'] = existing ? `${existing}; ${cookieHeader}` : cookieHeader;
    }
    return headers;
  }

  async _execute() {
    if (!this._promise) {
      this._promise = (async () => {
        const headers = this._applyAgentHeaders({ ...this._headers });
        const response = await createRequest(this.app, {
          method: this.method,
          path: this.path,
          headers,
          body: this._body
        });

        if (this.agent) {
          this.agent._storeCookies(response.headers);
        }

        this._runExpectations(response);
        return response;
      })();
    }
    return this._promise;
  }

  _runExpectations(response) {
    for (const expectation of this._expects) {
      if (expectation.type === 'status') {
        if (response.status !== expectation.value) {
          throw new Error(`Expected status ${expectation.value} but received ${response.status}`);
        }
      } else if (expectation.type === 'header') {
        const headerValue = getHeader(response.headers, expectation.field);
        if (expectation.value instanceof RegExp) {
          if (!expectation.value.test(headerValue || '')) {
            throw new Error(`Expected header ${expectation.field} to match ${expectation.value}`);
          }
        } else if (headerValue !== expectation.value) {
          throw new Error(`Expected header ${expectation.field} to equal ${expectation.value}, received ${headerValue}`);
        }
      } else if (expectation.type === 'custom') {
        expectation.handler(response);
      } else if (expectation.type === 'body') {
        const bodyValue = response.body;
        if (expectation.second === undefined) {
          if (bodyValue !== expectation.value) {
            throw new Error('Body expectation failed');
          }
        } else if (bodyValue?.[expectation.value] !== expectation.second) {
          throw new Error(`Expected body property ${expectation.value}`);
        }
      }
    }
  }
}

class Agent {
  constructor(app) {
    this.app = app;
    this.cookies = new Map();
    METHODS.forEach(method => {
      this[method.toLowerCase()] = path => new Test(this.app, method, path, this);
    });
  }

  _storeCookies(headers) {
    const raw = headers?.['set-cookie'];
    if (!raw) return;
    const cookies = Array.isArray(raw) ? raw : [raw];
    cookies.forEach(cookie => {
      const [pair] = cookie.split(';');
      const [name, value] = pair.split('=');
      if (name) {
        this.cookies.set(name.trim(), value);
      }
    });
  }

  _getCookieHeader() {
    if (this.cookies.size === 0) return '';
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

class RequestFactory {
  constructor(app) {
    this.app = app;
    METHODS.forEach(method => {
      this[method.toLowerCase()] = path => new Test(this.app, method, path, null);
    });
  }
}

function supertest(app) {
  return new RequestFactory(app);
}

supertest.agent = function agentFactory(app) {
  return new Agent(app);
};

module.exports = supertest;
