const normalizeCatalogKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Update these prices to your official cashier rate card when needed.
const CLINICAL_SERVICE_CATALOG = [
  {
    category: 'laboratory',
    service: 'Complete Blood Count (CBC)',
    unitPrice: 350,
    aliases: ['cbc', 'complete blood count', 'complete blood count cbc']
  },
  {
    category: 'laboratory',
    service: 'Urinalysis',
    unitPrice: 220,
    aliases: ['urinalysis', 'urine analysis']
  },
  {
    category: 'laboratory',
    service: 'Blood Chemistry',
    unitPrice: 480,
    aliases: ['blood chemistry', 'chemistry']
  },
  {
    category: 'laboratory',
    service: 'Fecalysis',
    unitPrice: 180,
    aliases: ['fecalysis', 'stool exam']
  },
  {
    category: 'radiology',
    service: 'Chest X-Ray',
    unitPrice: 650,
    aliases: ['x ray chest', 'chest x ray', 'xray chest']
  },
  {
    category: 'cardiology',
    service: 'Standard 12-Lead ECG',
    unitPrice: 450,
    aliases: ['standard 12 lead ecg', '12 lead ecg', '12lead ecg', 'standard ecg', 'ecg standard']
  },
  {
    category: 'cardiology',
    service: 'Stress Test',
    unitPrice: 2500,
    aliases: ['stress test', 'treadmill test', 'tmt', 'tm test']
  },
  {
    category: 'cardiology',
    service: 'Holter Monitoring',
    unitPrice: 3500,
    aliases: ['holter', 'holter monitoring', '24 hour holter', 'holter 24 hours']
  },
  {
    category: 'cardiology',
    service: 'ECG',
    unitPrice: 450,
    aliases: ['ecg', 'electrocardiogram']
  }
];

const catalogIndex = new Map();
for (const item of CLINICAL_SERVICE_CATALOG) {
  const keys = [item.service, ...(Array.isArray(item.aliases) ? item.aliases : [])];
  for (const key of keys) {
    const normalized = normalizeCatalogKey(key);
    if (normalized) catalogIndex.set(normalized, item);
  }
}

const categoryAliases = {
  lab: 'laboratory',
  laboratory: 'laboratory',
  radiology: 'radiology',
  ecg: 'cardiology',
  cardiology: 'cardiology',
  'physical therapy': 'therapy',
  therapy: 'therapy'
};

function resolveClinicalServicePricing({ kind, service } = {}) {
  const normalizedService = normalizeCatalogKey(service);
  const normalizedKind = categoryAliases[normalizeCatalogKey(kind)] || normalizeCatalogKey(kind);
  const match = normalizedService ? catalogIndex.get(normalizedService) : null;

  if (!match) {
    return {
      configured: false,
      source: 'unconfigured',
      category: normalizedKind || null,
      serviceLabel: String(service || kind || 'Clinical Service').trim() || 'Clinical Service',
      unitPrice: 0,
      currency: 'PHP'
    };
  }

  return {
    configured: true,
    source: normalizedKind && match.category && normalizedKind !== match.category ? 'catalog-service-match' : 'catalog',
    category: match.category || normalizedKind || null,
    serviceLabel: match.service,
    unitPrice: Number(match.unitPrice || 0),
    currency: 'PHP'
  };
}

module.exports = {
  CLINICAL_SERVICE_CATALOG,
  normalizeCatalogKey,
  resolveClinicalServicePricing
};
