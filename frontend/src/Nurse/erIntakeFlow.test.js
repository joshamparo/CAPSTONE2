import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(__dirname, 'NurseDashboard.js'), 'utf8');

test('ER intake does not request a cashier reference', () => {
  expect(source).toMatch(/if \(!isErIntake\)\s*\{[\s\S]*?\/api\/billing\/generate-ref/);
  expect(source).toMatch(/referencePending:\s*!isErIntake && !generatedRef/);
});

test('ER completion uses a triage slip and immediate-care instructions', () => {
  expect(source).toMatch(/ER TRIAGE & INTAKE SLIP/);
  expect(source).toMatch(/PROCEED IMMEDIATELY TO ER ASSESSMENT/);
  expect(source).toMatch(/Present this slip to the ER nurse or doctor\./);
  expect(source).toMatch(/Billing: Deferred until ER services are recorded/);
});

test('ER patients retain their queue ticket even when HMO details were captured', () => {
  expect(source).toMatch(/if \(isHmo && !isErIntake\) return null/);
  expect(source).toMatch(/addPatientData\.hasHmo && String\(addPatientData\.routeType \|\| ''\)\.toLowerCase\(\) !== 'er_consult'/);
  expect(source).toMatch(/isErIntake && addPatientData\.hasHmo[\s\S]*?'Pending verification'/);
});
