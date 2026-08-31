import { buildPatientWatchEntry, buildPatientWatchlist, getLatestRecordedVitals } from './nurseClinicalUtils';

describe('nurse clinical watchlist', () => {
  test('uses recorded clinical vitals instead of invented alert values', () => {
    const patient = {
      id: 'patient-1',
      first_name: 'Ana',
      last_name: 'Reyes',
      ward_number: '4',
      clinical_records: {
        vitals_logs: [{ blood_pressure: '186/110', heart_rate: 128, spo2: 89 }]
      }
    };

    expect(getLatestRecordedVitals(patient).heart_rate).toBe(128);
    expect(buildPatientWatchEntry(patient)).toMatchObject({
      id: 'patient-1',
      name: 'Ana Reyes',
      room: 'Ward 4',
      bp: '186/110',
      hr: '128',
      spo2: '89',
      status: 'critical'
    });
  });

  test('includes high-priority triage patients even when no vitals are recorded', () => {
    expect(buildPatientWatchEntry({ id: 'patient-2', firstName: 'Ben', triage_level: 2 })).toMatchObject({
      id: 'patient-2',
      status: 'watch',
      reason: 'Triage level 2'
    });
  });

  test('excludes patients without a recorded alert condition', () => {
    expect(buildPatientWatchlist([
      { id: 'stable', vitals: { bloodPressure: '120/80', heartRate: 75, spo2: 98, temperature: 36.8 } }
    ])).toEqual([]);
  });
});
