const express = require('express');
const router = express.Router();
const { createRateLimiter } = require('../utils/rateLimit');
const announcementWriteRateLimit = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 40,
    key: (req) => req.auth?.email || 'admin'
});
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

const announcementSseClients = new Map();

let announcementsSchemaPromise = null;

function ensureAnnouncementsSchema() {
    if (!announcementsSchemaPromise) {
        announcementsSchemaPromise = (async () => {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS public.announcements (
                    id BIGSERIAL PRIMARY KEY,
                    title TEXT,
                    content TEXT,
                    priority TEXT,
                    target TEXT,
                    author TEXT,
                    pinned BOOLEAN NOT NULL DEFAULT false,
                    expires_at TIMESTAMPTZ NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);
            await prisma.$executeRawUnsafe(`ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;`);
            await prisma.$executeRawUnsafe(`ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;`);
            await prisma.$executeRawUnsafe(`ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
            await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS announcements_created_idx ON public.announcements(created_at DESC);`);
        })().catch((err) => {
            announcementsSchemaPromise = null;
            throw err;
        });
    }
    return announcementsSchemaPromise;
}

function mulberry32(seed) {
    let t = seed >>> 0;
    return function next() {
        t += 0x6D2B79F5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function daySeed() {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return (y * 10000 + m * 100 + day) >>> 0;
}

function safeUrl(raw) {
    try {
        const u = new URL(String(raw || '').trim());
        if (u.protocol !== 'https:') return null;
        return u;
    } catch (_) {
        return null;
    }
}

const LIVE_NEWS_RSS_SOURCES = [
    {
        id: 'who-news',
        category: 'Global Health',
        label: 'WHO',
        sourceName: 'World Health Organization',
        url: 'https://www.who.int/rss-feeds/news-english.xml'
    }
];

const LIVE_NEWS_KEYWORDS = [
    'health',
    'hospital',
    'medical',
    'medicine',
    'doctor',
    'nurse',
    'patient',
    'doh',
    'disease',
    'vaccine',
    'vaccination',
    'virus',
    'clinic',
    'care',
    'wellness',
    'mental health',
    'emergency'
];

const LIVE_NEWS_MIN_RELEVANCE = 2;

const LIVE_NEWS_CACHE_MS = 10 * 60 * 1000;
let liveNewsCache = {
    fetchedAt: 0,
    items: []
};

function decodeXmlEntities(value) {
    return String(value || '')
        .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

function stripHtml(value) {
    // Some RSS feeds encode the whole HTML fragment, so decode before and
    // after removing tags to avoid leaking <p> or entity text to the UI.
    return decodeXmlEntities(decodeXmlEntities(String(value || ''))
        .replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

function compactSummary(value, max = 360) {
    const clean = stripHtml(value);
    if (clean.length <= max) return clean;
    const clipped = clean.slice(0, max + 1);
    const boundary = clipped.lastIndexOf(' ');
    return `${clipped.slice(0, boundary > max * 0.7 ? boundary : max).trim()}…`;
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function extractTag(block, tagName) {
    const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'));
    return match ? match[1] : '';
}

function extractAttr(block, tagName, attrName) {
    const match = String(block || '').match(
        new RegExp(`<${tagName}\\b[^>]*\\s${attrName}=(?:"([^"]+)"|'([^']+)')[^>]*\\/?>`, 'i')
    );
    return decodeXmlEntities(match?.[1] || match?.[2] || '').trim();
}

function firstValidImageUrl(...candidates) {
    for (const candidate of candidates) {
        const url = safeUrl(candidate);
        if (url) return url.toString();
    }
    return '';
}

function extractImageFromHtml(value) {
    const match = String(value || '').match(/<img\b[^>]*\ssrc=(?:"([^"]+)"|'([^']+)')[^>]*>/i);
    return decodeXmlEntities(match?.[1] || match?.[2] || '').trim();
}

function parsePubDate(value) {
    const parsed = new Date(String(value || '').trim());
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function scoreHealthRelevance(text) {
    const haystack = String(text || '').toLowerCase();
    return LIVE_NEWS_KEYWORDS.reduce((score, keyword) => (haystack.includes(keyword) ? score + 1 : score), 0);
}

function parseRssItems(xml, source) {
    const itemBlocks = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
    return itemBlocks
        .map((block, index) => {
            const title = stripHtml(extractTag(block, 'title'));
            const description = extractTag(block, 'description');
            const contentEncoded = extractTag(block, 'content:encoded');
            const summary = compactSummary(description || contentEncoded);
            const link = decodeXmlEntities(extractTag(block, 'link')).trim();
            const url = safeUrl(link);
            if (!title || !url) return null;

            const imageUrl = firstValidImageUrl(
                extractAttr(block, 'media:content', 'url'),
                extractAttr(block, 'media:thumbnail', 'url'),
                extractAttr(block, 'enclosure', 'url'),
                extractImageFromHtml(contentEncoded),
                extractImageFromHtml(description)
            );
            const publishedAt = parsePubDate(extractTag(block, 'pubDate'));

            const relevanceScore = scoreHealthRelevance(`${title} ${summary}`);
            if (relevanceScore < LIVE_NEWS_MIN_RELEVANCE) return null;

            return {
                id: `${source.id}-${slugify(title) || index}`,
                category: source.category,
                label: source.label,
                source: source.sourceName,
                title,
                summary: summary || `Read the full report from ${source.sourceName}.`,
                url: url.toString(),
                imageUrl,
                publishedAt,
                relevanceScore
            };
        })
        .filter(Boolean);
}

async function fetchRssSource(source) {
    const res = await fetch(source.url, {
        headers: {
            Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
            'User-Agent': 'PascualingaNewsBot/1.0'
        }
    });
    if (!res.ok) {
        throw new Error(`Failed to load ${source.sourceName}: ${res.status}`);
    }

    const xml = await res.text();
    return parseRssItems(xml, source);
}

function fallbackLiveNews() {
    return [
        {
            id: 'official-philhealth-partnership-2026', category: 'Philippine Health', label: 'PhilHealth', source: 'PhilHealth',
            title: 'PhilHealth and St. Luke’s formalize landmark health-care partnership',
            summary: 'Official PhilHealth update on expanding access to quality health care through a new institutional partnership.',
            url: 'https://www.philhealth.gov.ph/news/up/article/2026/news_6a8e8005e1b93.php', imageUrl: '', publishedAt: '2026-08-25T00:00:00.000Z'
        },
        {
            id: 'official-philhealth-leadership-2026', category: 'Philippine Health', label: 'PhilHealth', source: 'PhilHealth',
            title: 'PhilHealth’s new President and CEO vows to accelerate national health gains',
            summary: 'Official leadership update outlining continuity and acceleration of PhilHealth programs under the national health agenda.',
            url: 'https://www.philhealth.gov.ph/news/up/article/2026/news_6a8bd5523ff79.php', imageUrl: '', publishedAt: '2026-08-20T00:00:00.000Z'
        },
        {
            id: 'official-philhealth-human-right-2026', category: 'Philippine Health', label: 'PhilHealth', source: 'PhilHealth',
            title: 'PhilHealth and CHR champion health care as a fundamental human right',
            summary: 'PhilHealth and the Commission on Human Rights reinforce equitable access to quality health care for Filipinos.',
            url: 'https://www.philhealth.gov.ph/news/up/article/2026/news_6a3b405bdfbb6.php', imageUrl: '', publishedAt: '2026-06-23T00:00:00.000Z'
        },
        {
            id: 'official-philhealth-gamot-2026', category: 'Philippine Health', label: 'PhilHealth', source: 'PhilHealth',
            title: 'PhilHealth launches GAMOT in Zamboanga Sibugay',
            summary: 'The official GAMOT program update explains expanded access to essential outpatient medicines for eligible members.',
            url: 'https://www.philhealth.gov.ph/news/up/article/2026/news_6a2634094e2bd.php', imageUrl: '', publishedAt: '2026-06-04T00:00:00.000Z'
        },
        {
            id: 'official-who-philippines-releases', category: 'Philippine Health', label: 'WHO Philippines', source: 'World Health Organization',
            title: 'Latest official health releases from WHO Philippines',
            summary: 'Read verified public-health releases, statements, and joint updates from the WHO country office in the Philippines.',
            url: 'https://www.who.int/philippines/news/releases', imageUrl: '', publishedAt: null
        },
        {
            id: 'official-philhealth-news', category: 'Philippine Health', label: 'PhilHealth', source: 'PhilHealth',
            title: 'Latest official PhilHealth news and advisories',
            summary: 'Browse current benefit, primary-care, medicine-access, and member-service updates directly from PhilHealth.',
            url: 'https://www.philhealth.gov.ph/news/', imageUrl: '', publishedAt: null
        }
    ];
}

async function getLiveNews(limit) {
    const target = Math.max(1, Math.min(6, Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 3));
    const now = Date.now();
    if (liveNewsCache.items.length && now - liveNewsCache.fetchedAt < LIVE_NEWS_CACHE_MS) {
        return liveNewsCache.items.slice(0, target);
    }

    const settled = await Promise.allSettled(LIVE_NEWS_RSS_SOURCES.map((source) => fetchRssSource(source)));
    const combined = settled
        .filter((result) => result.status === 'fulfilled')
        .flatMap((result) => result.value);

    const seenUrls = new Set();
    const deduped = [];
    for (const item of combined) {
        const key = String(item.url || '').toLowerCase();
        if (!key || seenUrls.has(key)) continue;
        seenUrls.add(key);
        deduped.push(item);
    }

    deduped.sort((a, b) => {
        const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        if (bTime !== aTime) return bTime - aTime;
        if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
        return String(a.title || '').localeCompare(String(b.title || ''));
    });

    const trustedFallback = fallbackLiveNews();
    const liveLimit = Math.min(3, target);
    const merged = [...deduped.slice(0, liveLimit), ...trustedFallback].filter((item, index, items) => {
        const key = String(item.url || '').toLowerCase();
        return key && items.findIndex((candidate) => String(candidate.url || '').toLowerCase() === key) === index;
    });
    const finalItems = merged.slice(0, target)
        .map(({ relevanceScore, ...item }) => item);

    liveNewsCache = {
        fetchedAt: now,
        items: finalItems
    };
    return finalItems;
}

const PH_NEWS_POOL = [
    {
        id: 'philhealth-news',
        category: 'PhilHealth',
        label: 'Health Financing PH',
        title: 'PhilHealth News and Advisories',
        summary: 'Latest official updates, announcements, and advisories from PhilHealth for members and providers.',
        url: 'https://www.philhealth.gov.ph/news/'
    },
    {
        id: 'philhealth-konsulta',
        category: 'PhilHealth',
        label: 'Primary Care PH',
        title: 'Konsulta Program Updates',
        summary: 'Guidance and updates about PhilHealth’s Konsulta package and primary care benefit services.',
        url: 'https://www.philhealth.gov.ph/benefits/konsulta/'
    },
    {
        id: 'fda-advisories',
        category: 'FDA Philippines',
        label: 'Drug Safety PH',
        title: 'FDA Advisories',
        summary: 'Public health warnings and regulatory advisories from the Philippine Food and Drug Administration.',
        url: 'https://www.fda.gov.ph/advisories/'
    },
    {
        id: 'fda-general-advisories',
        category: 'FDA Philippines',
        label: 'Health Advisory PH',
        title: 'FDA General Advisories',
        summary: 'Official advisories and announcements related to public health and regulatory actions.',
        url: 'https://www.fda.gov.ph/category/general-advisories/'
    },
    {
        id: 'doh-home',
        category: 'DOH Philippines',
        label: 'Public Health PH',
        title: 'Department of Health Updates',
        summary: 'Official updates, health advisories, and public announcements from the Department of Health (Philippines).',
        url: 'https://doh.gov.ph/'
    },
    {
        id: 'doh-ncov',
        category: 'DOH Philippines',
        label: 'Health Advisory PH',
        title: 'DOH Health Advisories & Policies',
        summary: 'Official policies and advisories related to public health from the DOH Philippines website.',
        url: 'https://doh.gov.ph/2019-nCov'
    },
    {
        id: 'dost-health',
        category: 'DOST Philippines',
        label: 'Science & Health PH',
        title: 'DOST Science and Technology Updates',
        summary: 'National science and technology updates that often include health innovations and public programs.',
        url: 'https://www.dost.gov.ph/'
    }
];

function pickDailyNews(limit) {
    const allowedHosts = new Set(['philhealth.gov.ph', 'www.philhealth.gov.ph', 'fda.gov.ph', 'www.fda.gov.ph', 'doh.gov.ph', 'www.doh.gov.ph', 'dost.gov.ph', 'www.dost.gov.ph']);
    const pool = PH_NEWS_POOL.filter((n) => {
        const u = safeUrl(n.url);
        if (!u) return false;
        const host = String(u.hostname || '').toLowerCase();
        return allowedHosts.has(host);
    });

    const target = Math.max(1, Math.min(6, Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 3));
    const rng = mulberry32(daySeed());
    const arr = pool.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr.slice(0, Math.min(target, arr.length));
}

function roleToBucket(role) {
    const r = String(role || '').trim().toLowerCase();
    if (r === 'doctor') return 'doctor';
    if (r === 'nurse') return 'nurse';
    if (r === 'patient') return 'patient';
    if (r === 'admin') return 'admin';
    return 'staff';
}

function normalizeTarget(target) {
    const t = String(target || 'all').trim().toLowerCase();
    return t || 'all';
}

function shouldDeliverToBucket(target, bucket) {
    const t = normalizeTarget(target);
    if (t === 'all') return true;
    return t === String(bucket || '').toLowerCase();
}

function sseWrite(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastAnnouncement(announcementRow) {
    if (!announcementRow) return;
    const payload = {
        ...announcementRow,
        id: announcementRow.id != null ? String(announcementRow.id) : undefined,
        createdAt: announcementRow.created_at || announcementRow.createdAt || null,
        expiresAt: announcementRow.expires_at || announcementRow.expiresAt || null
    };

    for (const client of announcementSseClients.values()) {
        if (!client || !client.res) continue;
        if (!shouldDeliverToBucket(payload.target, client.bucket)) continue;
        try {
            sseWrite(client.res, 'announcement', payload);
        } catch (_) {}
    }
}

// @route   GET api/announcements
// @desc    Get all announcements
router.get('/', requireRole(['admin', 'nurse', 'doctor', 'pharmacist', 'staff', 'cashier', 'doctor_secretary', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'patient']), async (req, res) => {
    try {
        await ensureAnnouncementsSchema();
        const includeExpired = String(req.query.includeExpired || '').toLowerCase() === 'true';
        const announcements = includeExpired
            ? await prisma.$queryRaw`
                SELECT id, title, content, priority, target, author, pinned, expires_at, created_at
                FROM announcements
                ORDER BY pinned DESC, created_at DESC
              `
            : await prisma.$queryRaw`
                SELECT id, title, content, priority, target, author, pinned, expires_at, created_at
                FROM announcements
                WHERE (expires_at IS NULL OR expires_at > NOW())
                ORDER BY pinned DESC, created_at DESC
              `;

        const serialized = (Array.isArray(announcements) ? announcements : []).map((ann) => ({
            ...ann,
            id: ann.id != null ? ann.id.toString() : undefined,
            createdAt: ann.created_at,
            expiresAt: ann.expires_at
        }));
        
        res.json(serialized);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.get('/stream', (req, res) => {
    const role = String(req.query.role || '').trim().toLowerCase();
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!role || !email) return res.status(401).json({ message: 'Unauthorized' });

    const bucket = roleToBucket(role);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    res.write('retry: 3000\n\n');

    const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const keepAlive = setInterval(() => {
        try {
            res.write(':keep-alive\n\n');
        } catch (_) {}
    }, 25000);

    announcementSseClients.set(clientId, { id: clientId, res, role, bucket, email });
    try {
        sseWrite(res, 'ready', { ok: true });
    } catch (_) {}

    req.on('close', () => {
        clearInterval(keepAlive);
        announcementSseClients.delete(clientId);
    });
});

router.get('/news', async (req, res) => {
    try {
        const limitRaw = req.query.limit != null ? String(req.query.limit) : '';
        const picked = await getLiveNews(limitRaw);
        res.json(
            picked.map((n) => ({
                id: n.id,
                category: n.category,
                label: n.label,
                source: n.source,
                title: n.title,
                summary: n.summary,
                url: n.url,
                imageUrl: n.imageUrl || '',
                publishedAt: n.publishedAt || null
            }))
        );
    } catch (err) {
        console.error('News feed error:', err.message);
        res.status(200).json(fallbackLiveNews());
    }
});

// @route   POST api/announcements
// @desc    Create a new announcement
router.post('/', requireRole(['admin']), announcementWriteRateLimit, async (req, res) => {
    try {
        const cleanStr = (v) => String(v || "").trim();
        const titleRaw = cleanStr(req.body?.title);
        const contentRaw = cleanStr(req.body?.content);
        const priorityRaw = cleanStr(req.body?.priority || 'Normal') || 'Normal';
        const targetRaw = cleanStr(req.body?.target || 'All') || 'All';
        const authorRaw = cleanStr(req.auth?.email || 'Admin') || 'Admin';
        const pinnedRaw = req.body?.pinned === true;
        const expiresAtRaw = req.body?.expiresAt;

        if (!titleRaw) return res.status(400).json({ message: "Announcement title is required." });
        if (titleRaw.length < 4) return res.status(400).json({ message: "Announcement title is too short (min 4 characters)." });
        if (titleRaw.length > 160) return res.status(400).json({ message: "Announcement title is too long (max 160 characters)." });
        if (!contentRaw) return res.status(400).json({ message: "Announcement message / content is required." });
        if (contentRaw.length < 6) return res.status(400).json({ message: "Announcement message is too short (min 6 characters)." });
        if (contentRaw.length > 4000) return res.status(400).json({ message: "Announcement message is too long (max 4000 characters)." });

        const allowedPriority = new Set(['Low', 'Normal', 'High', 'Urgent', 'Info']);
        const priority = allowedPriority.has(priorityRaw) ? priorityRaw : 'Normal';

        const allowedTargets = new Set([
            'All', 'Doctor', 'Nurse', 'Staff', 'Admin', 'Patient', 'Pharmacist', 'Cashier',
            'Doctor Secretary', "Doctor's Secretary", 'MedTech', 'Medtechs', 'Radiographer', 'Radiographer (X-ray)',
            'ECG Operator', 'Physical Therapist', 'Office Staff', 'Clinical Staff'
        ]);
        if (!allowedTargets.has(targetRaw)) return res.status(400).json({ message: 'Unsupported announcement target.' });
        const target = targetRaw;

        const parsedExpires = expiresAtRaw ? new Date(expiresAtRaw) : null;
        if (expiresAtRaw && Number.isNaN(parsedExpires.getTime())) return res.status(400).json({ message: 'Invalid announcement expiry.' });
        const expires_at = parsedExpires && !Number.isNaN(parsedExpires.getTime()) ? parsedExpires : null;

        const created = await prisma.announcements.create({
            data: {
                title: titleRaw,
                content: contentRaw,
                priority,
                target,
                author: authorRaw,
                pinned: pinnedRaw,
                expires_at
            }
        });
        const announcement = created;

        // Log Activity
        await prisma.activity_logs.create({
            data: {
                actor_name: authorRaw,
                role: 'Admin',
                action: 'Create',
                target: 'Announcement',
                details: `Posted announcement: ${titleRaw}`
            }
        }).catch(() => {});

        if (!announcement) return res.status(500).json({ message: 'Server Error' });
        broadcastAnnouncement(announcement);
        const normalized = { ...announcement, id: announcement.id ? announcement.id.toString() : undefined };
        normalized.createdAt = normalized.created_at || normalized.createdAt;
        normalized.expiresAt = normalized.expires_at || normalized.expiresAt;
        res.json(normalized);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   PATCH api/announcements/:id
// @desc    Update pinned/expiry for an announcement
router.patch('/:id', requireRole(['admin']), announcementWriteRateLimit, async (req, res) => {
    try {
        const { pinned, expiresAt } = req.body || {};
        if (!/^\d+$/.test(String(req.params.id || ''))) return res.status(400).json({ message: 'Invalid announcement id.' });
        const id = BigInt(req.params.id);
        const hasPinned = typeof pinned === 'boolean';
        const clearExpiry = expiresAt === null;
        const hasExpires = typeof expiresAt === 'string';
        const parsedExpires = hasExpires ? new Date(expiresAt) : null;
        const nextExpires = parsedExpires && !Number.isNaN(parsedExpires.getTime()) ? parsedExpires : null;

        const rows = await prisma.$queryRaw`
            UPDATE announcements
            SET
              pinned = CASE WHEN ${hasPinned} THEN ${pinned} ELSE pinned END,
              expires_at = CASE
                WHEN ${clearExpiry} THEN NULL
                WHEN ${hasExpires} THEN ${nextExpires}
                ELSE expires_at
              END
            WHERE id = ${id}
            RETURNING id, title, content, priority, target, author, pinned, expires_at, created_at
        `;
        const updated = Array.isArray(rows) ? rows[0] : null;
        if (!updated) return res.status(404).json({ msg: 'Announcement not found' });
        await prisma.activity_logs.create({
            data: {
                actor_name: String(req.auth?.email || 'Admin'),
                role: 'Admin',
                action: 'Update Announcement',
                target: String(updated.id),
                details: `Updated announcement controls: ${updated.title}`.slice(0, 1000)
            }
        }).catch(() => {});
        res.json({ ...updated, id: updated.id.toString(), createdAt: updated.created_at, expiresAt: updated.expires_at });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE api/announcements/:id
// @desc    Delete an announcement
router.delete('/:id', requireRole(['admin']), announcementWriteRateLimit, async (req, res) => {
    try {
        if (!/^\d+$/.test(String(req.params.id || ''))) return res.status(400).json({ message: 'Invalid announcement id.' });
        const announcement = await prisma.announcements.findUnique({
            where: { id: BigInt(req.params.id) }
        });

        if (!announcement) {
            return res.status(404).json({ msg: 'Announcement not found' });
        }

        await prisma.announcements.delete({
            where: { id: BigInt(req.params.id) }
        });

        // Log Activity
        await prisma.activity_logs.create({
            data: {
                actor_name: String(req.auth?.email || 'Admin'),
                role: 'Admin',
                action: 'Delete',
                target: 'Announcement',
                details: `Deleted announcement: ${announcement.title}`
            }
        });

        res.json({ msg: 'Announcement removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
module.exports._newsTest = { decodeXmlEntities, stripHtml, compactSummary, fallbackLiveNews };

