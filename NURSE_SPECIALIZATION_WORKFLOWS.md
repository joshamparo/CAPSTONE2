# Nurse specialization workflows

All 15 nurse specializations use the same patient record system, with department-scoped access enforced by the backend. An account must have a valid stored specialization; an unassigned account no longer inherits ER permissions.

## Using the nurse workspace

1. Open **Patient Records** to search department patients. The previous/next controls are above the list. CSV download and printing include the selected filter across all pages. The eye button opens the profile; the record button opens the central chart and its print action.
2. Open **Specialty Care & Handoffs**, select **Care timeline**, and start or continue the department episode.
3. Select an existing patient order when the care supports an order, or leave the reference empty for routine nursing care. Complete the specialty preparation checks and documentation.
4. Save each stage: **Preparation → In progress → Handed off → Completed**. Handoff requires documentation and a receiving team/staff name. A cancelled episode requires a documented reason. Completed/cancelled episodes remain read-only; a new episode can be started.
5. Authorized care teams see these episodes in the shared care timeline and the central patient chart. Referenced orders receive a nursing-support event. Nursing documentation does not automatically complete the doctor's order or release diagnostic results.

Concurrent edits return a conflict instead of overwriting another nurse's work. Reload the timeline to review the latest version. Audit history records the signed-in nurse, time, stage, checklist and notes.

## Specialty modules

| Specialization | Specialty care workflow |
| --- | --- |
| ER | Triage/receiving-team checks and patient endorsement |
| OPD | Arrival, rooming, doctor notification and follow-up |
| PEDIA | Guardian, weight review, observation and family handoff |
| Medicine | Bedside rounds, orders and shift handoff |
| Laboratory | Patient/request matching, specimen labeling and collection handoff |
| Video Consultation | Identity, connection readiness and consult follow-up |
| ECG | Request matching, preparation and operator handoff |
| Radiology | Exam preparation, transport and imaging handoff |
| Physical Therapy | Referral, ordered restrictions and therapist coordination |
| Dental Clinic | Visit preparation, assistance and aftercare handoff |
| Surgery (Minor) | Procedure/consent documentation checks and recovery handoff |
| Anesthesia | Order review, preparation and recovery documentation |
| ENT | Visit/procedure assistance and follow-up |
| Pathology | Specimen/container identification and receiving-service handoff |
| Orthopedics | Mobility restrictions, assistance and rehabilitation coordination |

These are nursing documentation and coordination workflows. They do not calculate medication doses, interpret tests, or make clinical decisions. Procedure checks document staff review of the actual orders.

Unrelated medication administration tools are hidden outside ER, Pedia, Medicine, Orthopedics, Minor Surgery and Anesthesia. Laboratory, Pathology, ECG and Radiology use the specialty patient/order workflow instead of a generic consultation or medication-order screen. Shared tasks, calendar and ward occupancy remain available.

## Ward and record permissions

- Every nurse can see the hospital ward/room occupancy overview. Nurses outside ER and Medicine receive occupancy without unrelated patient identifiers or room notes.
- Only ER and Medicine nurses can assign, transfer or discharge ward patients. Administrators retain their existing management access.
- Select **Transfer** on an occupied room, then an available destination room. An existing doctor transfer request is required. Reserved, cleaning, maintenance and inactive rooms cannot be assigned.
- The backend serializes assignments and rechecks availability inside the transaction. Discharge and assignment create audit entries.
- General patient-profile updates cannot change nurse ward placement or admission status. The old admission form that bypassed room checks was removed.
- Department access comes from recorded appointments, service orders, intake routes, actual ward placement and retained treatment history. Age, diagnosis guesses and loose substring matches do not authorize patient access.
- Ward assignment/discharge and specialty care preserve treatment-department history, keeping those historical patients accessible after discharge. Legacy records without a verifiable assignment are not automatically assigned to a specialty.
- Saving nursing vitals preserves intake/routing data and appends the observation. The central chart includes nursing observations and specialty history in its printable timeline.

## Rollout and verification

Deploy the backend and frontend together. `manual_migration_nurse_specialty_care.sql` is additive and is discovered by the existing backend startup schema bootstrap. The API also initializes the new tables if necessary. The tables enable row-level security so access remains through authenticated backend routes.

Automated checks cover all 15 scopes, unauthorized ward mutations, workflow progression/cancellation, linked-patient validation, stale edits, historical access, preservation of clinical records, and frontend patient pagination/view/save actions. Production-account testing still requires the deployed backend/database and representative department accounts; local automated checks are not a live clinical acceptance test.
