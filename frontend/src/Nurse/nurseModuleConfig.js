const BASE = Object.freeze({
  overview: true,
  patients: true,
  schedules: true,
  appointments: false,
  vitals: false,
  orders: false,
  medications: false,
  wards: false,
  reception: false,
  erIntake: false,
  screeningMode: 'standard',
  orderTabs: []
});

const CONFIGS = {
  ER: { appointments: true, vitals: true, orders: true, medications: true, wards: true, reception: true, erIntake: true, orderTabs: ['medications', 'labs', 'supplies'] },
  PEDIA: { appointments: true, vitals: true, orders: true, medications: true, wards: true, orderTabs: ['medications', 'labs', 'supplies'] },
  PEDIATRICS: { appointments: true, vitals: true, orders: true, medications: true, wards: true, orderTabs: ['medications', 'labs', 'supplies'] },
  MEDICINE: { vitals: true, orders: true, medications: true, wards: true, orderTabs: ['medications', 'labs', 'supplies'] },
  ORTHOPEDICS: { vitals: true, orders: true, medications: true, wards: true, orderTabs: ['medications', 'labs', 'supplies'] },
  OPD: { appointments: true, vitals: true, orders: true, orderTabs: ['labs', 'supplies'] },
  DENTALCLINIC: { appointments: true, vitals: true, orders: true, screeningMode: 'dental', orderTabs: ['labs', 'supplies'] },
  OTOLARYNGOLOGYENT: { appointments: true, vitals: true, orders: true, orderTabs: ['labs', 'supplies'] },
  PHYSICALTHERAPY: { appointments: true, vitals: true, orders: true, screeningMode: 'therapy', orderTabs: ['supplies'] },
  LABORATORY: { appointments: true, orders: true, orderTabs: ['labs', 'supplies'] },
  PATHOLOGY: { appointments: true, orders: true, orderTabs: ['labs', 'supplies'] },
  RADIOLOGY: { appointments: true, orders: true, orderTabs: ['labs', 'supplies'] },
  ECG: { appointments: true, orders: true, orderTabs: ['labs', 'supplies'] },
  VIDEOCONSULTATION: { appointments: true },
  SURGERYMINOR: { appointments: true, vitals: true, orders: true, medications: true, orderTabs: ['medications', 'labs', 'supplies'] },
  ANESTHESIA: { appointments: true, vitals: true, orders: true, medications: true, orderTabs: ['medications', 'labs', 'supplies'] }
};

const MODULE_KEY_ALIASES = Object.freeze({
  EMERGENCY: 'ER',
  EMERGENCYROOM: 'ER',
  EMERGENCYNURSING: 'ER',
  ERNURSING: 'ER',
  OUTPATIENT: 'OPD',
  OUTPATIENTDEPARTMENT: 'OPD',
  OUTPATIENTDEPT: 'OPD',
  PEDIATRICS: 'PEDIA',
  INTERNALMEDICINE: 'MEDICINE'
});

export const normalizeNurseModuleKey = (value) => {
  const compact = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return MODULE_KEY_ALIASES[compact] || compact;
};

export const getNurseModuleConfig = (specializationKey, workspaceType = 'general') => {
  const key = normalizeNurseModuleKey(specializationKey);
  const fallback = !CONFIGS[key] && workspaceType === 'general'
    ? { appointments: true, vitals: true, orders: true, orderTabs: ['labs', 'supplies'] }
    : {};
  return { ...BASE, ...fallback, ...(CONFIGS[key] || {}) };
};

export default getNurseModuleConfig;
