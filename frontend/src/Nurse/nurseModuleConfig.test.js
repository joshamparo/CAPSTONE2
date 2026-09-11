import { getNurseModuleConfig, normalizeNurseModuleKey } from './nurseModuleConfig';

test('dental clinic excludes inpatient and e-MAR modules', () => {
  const config = getNurseModuleConfig('DENTALCLINIC', 'clinic');
  expect(config).toMatchObject({ appointments: true, vitals: true, orders: true, wards: false, medications: false, screeningMode: 'dental' });
});

test('only inpatient nursing scopes receive ward management', () => {
  expect(getNurseModuleConfig('ER', 'emergency').wards).toBe(true);
  expect(getNurseModuleConfig('MEDICINE', 'bedside').wards).toBe(true);
  expect(getNurseModuleConfig('ORTHOPEDICS', 'bedside').wards).toBe(true);
  ['OPD', 'DENTALCLINIC', 'LABORATORY', 'PATHOLOGY', 'RADIOLOGY', 'ECG', 'PHYSICALTHERAPY', 'VIDEOCONSULTATION', 'SURGERYMINOR', 'ANESTHESIA'].forEach((key) => {
    expect(getNurseModuleConfig(key).wards).toBe(false);
  });
});

test('diagnostic, imaging and remote scopes expose only relevant workflow modules', () => {
  expect(getNurseModuleConfig('LABORATORY')).toMatchObject({ appointments: true, orders: true, vitals: false, medications: false });
  expect(getNurseModuleConfig('RADIOLOGY')).toMatchObject({ appointments: true, orders: true, vitals: false, medications: false });
  expect(getNurseModuleConfig('VIDEOCONSULTATION')).toMatchObject({ appointments: true, orders: false, vitals: false, wards: false });
});

test('Emergency Nursing aliases retain the complete head ER nurse workspace', () => {
  expect(normalizeNurseModuleKey('Emergency Nursing')).toBe('ER');
  expect(normalizeNurseModuleKey('Emergency Room')).toBe('ER');
  expect(getNurseModuleConfig('Emergency Nursing', 'emergency')).toMatchObject({
    patients: true,
    appointments: true,
    vitals: true,
    orders: true,
    medications: true,
    wards: true,
    reception: true,
    erIntake: true,
    schedules: true
  });
});
