import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SpecialtyCareBoard from './SpecialtyCareBoard';
import { fetchJson } from '../utils/api';
jest.mock('../utils/api', () => ({ fetchJson: jest.fn() }));
const config = { department: 'LABORATORY', title: 'Specimen Handoff', checks: ['Identity checked', 'Label checked'], fields: ['Specimen reference', 'Handoff notes'], stages: ['Preparation', 'In progress', 'Handed off', 'Completed'] };
const patients = Array.from({ length: 10 }, (_, i) => ({ _id: `p${i}`, firstName: `Patient${i}`, lastName: 'Test' }));
beforeEach(() => {
  fetchJson.mockReset();
  fetchJson.mockImplementation(async path => path.endsWith('/config') ? config : []);
});
test('patient controls paginate at the top, search resets pagination, and records remain viewable', async () => {
  const view = jest.fn();
  render(<SpecialtyCareBoard apiBase="" getHeaders={() => ({})} patients={patients} onViewRecord={view} />);
  await screen.findByText('Specimen Handoff');
  expect(screen.queryByText('Patient8 Test')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Next patient page'));
  expect(screen.getByText('Patient8 Test')).toBeInTheDocument();
  fireEvent.click(screen.getAllByText('View record')[0]);
  expect(view).toHaveBeenCalledWith(patients[8]);
  fireEvent.change(screen.getByLabelText('Find department patient'), { target: { value: 'Patient0' } });
  expect(screen.getByText('Patient0 Test')).toBeInTheDocument();
  expect(screen.getByLabelText('Previous patient page')).toBeDisabled();
  expect(screen.getByLabelText('Next patient page')).toBeDisabled();
});
test('saving a specialty episode sends the patient, checks, and documentation to the API', async () => {
  fetchJson.mockImplementation(async (path, options) => {
    if (path.endsWith('/config')) return config;
    if (options?.method === 'POST') return { id: 'episode', department: config.department, stage: 'Preparation', notes: ['S1', 'Collected'], checks: [true, true], history: [], version: 1, updated_at: new Date().toISOString() };
    return [];
  });
  render(<SpecialtyCareBoard apiBase="" getHeaders={() => ({ Authorization: 'test' })} patients={patients} onViewRecord={() => {}} />);
  await screen.findByText('Specimen Handoff');
  fireEvent.click(screen.getAllByText('Care timeline')[0]);
  fireEvent.click(await screen.findByText('Start department episode'));
  fireEvent.click(screen.getByLabelText('Identity checked'));
  fireEvent.click(screen.getByLabelText('Label checked'));
  fireEvent.change(screen.getByLabelText('Specimen reference'), { target: { value: 'S1' } });
  fireEvent.change(screen.getByLabelText('Handoff notes'), { target: { value: 'Collected' } });
  fireEvent.click(screen.getByText('Save care record'));
  await screen.findByText(/Care record saved/);
  const call = fetchJson.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(call[0]).toBe('/api/nurse-workflow/specialty-care/p0');
  expect(JSON.parse(call[1].body)).toMatchObject({ checks: [true, true], notes: ['S1', 'Collected'], stage: 'Preparation' });
  expect(screen.getByText('LABORATORY · Preparation')).toBeInTheDocument();
});
test('a denied patient timeline displays the error and does not offer an episode editor', async () => {
  fetchJson.mockImplementation(async path => { if (path.endsWith('/config')) return config; throw new Error('Patient is outside your department.'); });
  render(<SpecialtyCareBoard apiBase="" getHeaders={() => ({})} patients={patients} onViewRecord={() => {}} />);
  await screen.findByText('Specimen Handoff');
  fireEvent.click(screen.getAllByText('Care timeline')[0]);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('outside your department'));
  expect(screen.queryByText('Start department episode')).not.toBeInTheDocument();
});
