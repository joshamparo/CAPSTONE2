const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

function boundedDatabaseUrl(rawUrl = process.env.DATABASE_URL) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    // Nano has a small direct-connection allowance. Keep each Railway process
    // from reserving Prisma's CPU-derived default pool while still permitting
    // a few concurrent requests. Operators can tune this without a code change.
    const params = [];
    if (!url.searchParams.has('connection_limit')) {
      const requested = Number(process.env.PRISMA_CONNECTION_LIMIT || 5);
      params.push(`connection_limit=${Math.max(1, Math.min(5, Number.isFinite(requested) ? requested : 5))}`);
    }
    if (!url.searchParams.has('pool_timeout')) params.push('pool_timeout=45');
    // Never serialize the parsed URL: doing so can re-encode percent-escaped
    // credentials. Append only controlled query parameters to the exact input.
    return params.length ? `${raw}${raw.includes('?') ? '&' : '?'}${params.join('&')}` : raw;
  } catch (_) {
    return raw;
  }
}

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__pascualingaPrisma ||
  new PrismaClient({
    ...(boundedDatabaseUrl() ? { datasources: { db: { url: boundedDatabaseUrl() } } } : {}),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
  });

if (!globalForPrisma.__pascualingaPrisma) {
  globalForPrisma.__pascualingaPrisma = prisma;
}

function shortStack(skip = 2) {
  const stack = String(new Error().stack || '')
    .split('\n')
    .slice(skip)
    .filter(Boolean)
    .slice(0, 6)
    .join('\n');
  return stack;
}

function describeQueryArg(arg) {
  if (typeof arg === 'string') {
    const trimmed = arg.trim();
    return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
  }
  if (Array.isArray(arg) && Object.prototype.hasOwnProperty.call(arg, 'raw')) {
    // Tagged template strings array (TemplateStringsArray).
    const joined = arg.join('');
    const trimmed = joined.trim();
    return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
  }
  if (arg && typeof arg === 'object' && typeof arg.sql === 'string') {
    const trimmed = arg.sql.trim();
    return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
  }
  if (arg && typeof arg === 'object') {
    return `[object ${arg.constructor && arg.constructor.name ? arg.constructor.name : 'Object'}]`;
  }
  return String(arg);
}

if (!prisma.__pascualingaPatched) {
  prisma.__pascualingaPatched = true;

  const origQueryRawUnsafe = prisma.$queryRawUnsafe.bind(prisma);
  prisma.$queryRawUnsafe = async (...args) => {
    const q = args[0];
    if (typeof q !== 'string') {
      console.error('Invalid $queryRawUnsafe first arg:', describeQueryArg(q), '\n', shortStack());
      throw new Error('Invalid $queryRawUnsafe query (must be string)');
    }
    if (q.includes('[object Object]')) {
      console.error('Possible [object Object] in SQL query:', describeQueryArg(q), '\n', shortStack());
    }
    try {
      return await origQueryRawUnsafe(...args);
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('syntax error') || msg.toLowerCase().includes('object')) {
        console.error('SQL error in $queryRawUnsafe:', msg, '\nQuery:', describeQueryArg(q), '\n', shortStack());
      }
      throw err;
    }
  };

  const origQueryRaw = prisma.$queryRaw.bind(prisma);
  prisma.$queryRaw = async (...args) => {
    const q = args[0];
    if (typeof q !== 'string' && !(Array.isArray(q) && Object.prototype.hasOwnProperty.call(q, 'raw')) && !(q && typeof q === 'object')) {
      console.error('Invalid $queryRaw first arg:', describeQueryArg(q), '\n', shortStack());
      throw new Error('Invalid $queryRaw query');
    }
    const rendered = describeQueryArg(q);
    if (rendered.includes('[object Object]')) {
      console.error('Possible [object Object] in $queryRaw:', rendered, '\n', shortStack());
    }
    try {
      return await origQueryRaw(...args);
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('syntax error') || msg.toLowerCase().includes('object')) {
        console.error('SQL error in $queryRaw:', msg, '\nQuery:', rendered, '\n', shortStack());
      }
      throw err;
    }
  };

  const origExecuteRawUnsafe = prisma.$executeRawUnsafe.bind(prisma);
  prisma.$executeRawUnsafe = async (...args) => {
    const q = args[0];
    if (typeof q !== 'string') {
      console.error('Invalid $executeRawUnsafe first arg:', describeQueryArg(q), '\n', shortStack());
      throw new Error('Invalid $executeRawUnsafe query (must be string)');
    }
    if (q.includes('[object Object]')) {
      console.error('Possible [object Object] in SQL exec:', describeQueryArg(q), '\n', shortStack());
    }
    try {
      return await origExecuteRawUnsafe(...args);
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('syntax error') || msg.toLowerCase().includes('object')) {
        console.error('SQL error in $executeRawUnsafe:', msg, '\nQuery:', describeQueryArg(q), '\n', shortStack());
      }
      throw err;
    }
  };

  const origExecuteRaw = prisma.$executeRaw.bind(prisma);
  prisma.$executeRaw = async (...args) => {
    const q = args[0];
    const rendered = describeQueryArg(q);
    if (rendered.includes('[object Object]')) {
      console.error('Possible [object Object] in $executeRaw:', rendered, '\n', shortStack());
    }
    try {
      return await origExecuteRaw(...args);
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('syntax error') || msg.toLowerCase().includes('object')) {
        console.error('SQL error in $executeRaw:', msg, '\nQuery:', rendered, '\n', shortStack());
      }
      throw err;
    }
  };
}

module.exports = prisma;
module.exports.__test = { boundedDatabaseUrl };
