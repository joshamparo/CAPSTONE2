const express = require('express');

const router = express.Router();

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = String(process.env.OPENAI_ASSISTANT_MODEL || 'gpt-5-mini').trim();
const OPENAI_TIMEOUT_MS = Math.max(3000, Math.trunc(Number(process.env.OPENAI_TIMEOUT_MS || 12000)));

// Lightweight in-memory rate limiter for `/api/assistant/chat`.
// Demo-safe: prevents spam/polling loops from hammering backend/OpenAI.
const ASSISTANT_RATE_LIMIT_WINDOW_MS = Math.max(5000, Math.trunc(Number(process.env.ASSISTANT_RATE_LIMIT_WINDOW_MS || 15_000)));
const ASSISTANT_RATE_LIMIT_MAX = Math.max(1, Math.trunc(Number(process.env.ASSISTANT_RATE_LIMIT_MAX || 8)));
const assistantRateState = new Map(); // key -> { count, resetAt }

const PUBLIC_KNOWLEDGE = [
  {
    id: 'public-services',
    title: 'Hospital services',
    text: 'Pascual General Hospital publicly highlights medicine, pediatrics, obstetrics and gynecology, dermatology, surgery, orthopedics, anesthesia, radiology, pathology, ophthalmology, otolaryngology, urology, and dental medicine.'
  },
  {
    id: 'public-contact',
    title: 'Contact information',
    text: 'The public contact details shown on the website include the emergency and contact number 0915 312 7144, the email address pascualgenhospi@gmail.com, and the location Pascual General Hospital, Novaliches, Quezon City, Metro Manila.'
  },
  {
    id: 'public-hours',
    title: 'Hospital availability',
    text: 'The website says the hospital is available 24/7 for emergencies and encourages visitors to use the emergency contact number for urgent needs.'
  },
  {
    id: 'public-about',
    title: 'Hospital identity',
    text: 'The homepage presents Pascual General Hospital as a private, community-rooted hospital focused on compassionate care, organized services, and professional support for families.'
  },
  {
    id: 'public-trust',
    title: 'Trust indicators',
    text: 'Public trust indicators shown on the website include clearly published contact details, a physical location in Novaliches, Quezon City, visible service information, emergency contact access, and a professional public-facing hospital website.'
  },
  {
    id: 'public-history',
    title: 'Hospital background',
    text: 'The public website presents Pascual General Hospital as an established private hospital serving the community, but it does not publish a detailed long-form historical timeline. The assistant should explain only that public identity unless more official history is added to the site.'
  },
  {
    id: 'public-facilities',
    title: 'Facilities and care environment',
    text: 'The homepage highlights the hospital environment and facilities through public sections about hospital spaces, care support, and a professional private-hospital setting intended to make visitors feel informed and reassured.'
  },
  {
    id: 'public-pharmacy',
    title: 'Pharmacy support',
    text: 'The homepage highlights pharmacy support, accessible medicine coordination, safe dispensing, and convenient service points as part of the public-facing hospital experience.'
  },
  {
    id: 'public-community',
    title: 'Community role',
    text: 'The website presents Pascual General Hospital as a private hospital that serves families and the surrounding community in Novaliches, Quezon City with accessible information, organized care, and emergency readiness.'
  },
  {
    id: 'public-mission',
    title: 'Mission',
    text: 'The homepage mission statement says: We are committed to deliver optimum holistic patient care by providing accessible, compassionate and quality healthcare.'
  },
  {
    id: 'public-vision',
    title: 'Vision',
    text: 'The homepage vision statement says: To be the ideal God and patient-centered care provider in the community we serve.'
  },
  {
    id: 'public-values',
    title: 'Core values',
    text: 'The homepage includes a Mission, Vision and Core Values section that presents the hospital as guided by compassionate, accessible, quality, and community-centered healthcare principles.'
  },
  {
    id: 'public-emergency',
    title: 'Emergency support',
    text: 'The homepage says the emergency department is staffed 24/7 and highlights 0915 312 7144 as the emergency contact number for urgent concerns and immediate coordination.'
  },
  {
    id: 'public-news',
    title: 'News and updates',
    text: 'The homepage includes real health and public-interest news links and official hospital updates, but the assistant should only summarize what is publicly available and should not invent unpublished announcements.'
  },
  {
    id: 'public-booking',
    title: 'Consultation booking and walk-ins',
    text: 'For general guidance, patients may consult via scheduled appointments or walk-in workflows depending on availability. The assistant should guide users to the correct role-based module or to contact the hospital if they need immediate confirmation.'
  },
  {
    id: 'public-billing',
    title: 'Billing and payments (general)',
    text: 'Billing is handled through authorized hospital staff workflows. For general questions, the assistant may explain that charges are recorded and payments are collected by authorized staff (cashier/admin) and reflected in daily closeout summaries.'
  },
  {
    id: 'public-visiting',
    title: 'Visiting and inquiries',
    text: 'For visiting arrangements and non-emergency inquiries, visitors should use the published contact details or coordinate with hospital staff. If visiting hours are not published, the assistant should say so and suggest contacting the hospital.'
  },
  {
    id: 'public-lab-imaging',
    title: 'Laboratory and imaging (general)',
    text: 'The system includes internal workflows for labs and imaging coordination. Public visitors can ask about availability or contact details, but test ordering and results handling occur inside authorized staff workflows.'
  },
  {
    id: 'public-requirements',
    title: 'Common requirements (general)',
    text: 'For common hospital transactions, patients are typically asked for basic identification and contact details. The assistant should avoid inventing specific requirements and instead suggest confirming requirements with hospital staff if unsure.'
  }
];

const SYSTEM_KNOWLEDGE = [
  {
    id: 'system-overview',
    title: 'System overview',
    text: 'The Pascualinga platform combines a public hospital website with role-based internal dashboards so visitors can access hospital information while authorized users can manage operational, administrative, and clinical workflows.'
  },
  {
    id: 'system-roles',
    title: 'Supported roles',
    text: 'The internal system is designed for role-based use by administrators, doctors, nurses, pharmacists, cashiers, doctor secretaries, medtechs, radiographers, ECG operators, physical therapists, general staff, and patient-facing accounts where applicable.'
  },
  {
    id: 'system-role-security',
    title: 'Role-based access',
    text: 'Users should only access features, records, and workflows that are visible to their own authorized role. The assistant should guide users within their role and avoid exposing restricted functionality from other dashboards.'
  },
  {
    id: 'system-assistant-scope',
    title: 'Assistant scope',
    text: 'The assistant helps with public hospital information and role-appropriate workflow guidance. It is not a diagnostic tool, does not prescribe treatment, and should not invent unsupported system steps.'
  },
  {
    id: 'system-admin',
    title: 'Administrative operations',
    text: 'The admin side of the system includes dashboards for announcements, staff management, inventory, analytics, settings, role permissions, and operational monitoring.'
  },
  {
    id: 'system-clinical',
    title: 'Clinical workflows',
    text: 'The clinical side of the system supports patient queue handling, records, requests, approvals, laboratory and imaging task visibility, prescriptions, and role-specific workflow coordination.'
  },
  {
    id: 'system-public-purpose',
    title: 'Website purpose',
    text: 'The public website is intended to help visitors understand hospital services, contact details, location, facilities, emergency access, and official updates while presenting a professional private-hospital identity.'
  }
];

const ROLE_GUIDES = {
  admin: [
    'Admin users can manage staff, announcements, patients, inventory, settings, analytics, and role permissions from the admin dashboard.',
    'When an admin asks for help, explain the most likely dashboard workflow, such as navigating to announcements, staff management, inventory, reports, or settings.',
    'Admins should be reminded to use authorized modules for edits rather than attempting unsupported shortcuts.'
  ],
  doctor: [
    'Doctors use the doctor dashboard for patients queue, worklist, patient records, certificates, labs, approval inbox, and doctor chat.',
    'Doctor guidance should focus on patient queue review, orders, certificates, approvals, and patient-related workflows inside the doctor dashboard.'
  ],
  nurse: [
    'Nurses use the nurse dashboard for patient monitoring, ward-related tasks, patient records, and operational clinical workflows.',
    'Nurse guidance should stay within nursing workflows and never expose admin-only configuration steps.'
  ],
  pharmacist: [
    'Pharmacists use the pharmacy dashboard for dispensing, prescriptions, pharmacy POS, inventory-related stock handling, and profile/account actions.',
    'Pharmacist guidance should focus on medication, dispensing, stock, and pharmacy workflow questions inside authorized modules.'
  ],
  cashier: [
    'Cashiers use the cashier dashboard for billing, payment status updates, receipts, and transaction-related workflows.',
    'Cashier guidance should focus on locating billing records, reviewing payment details, and updating allowed payment information.'
  ],
  doctor_secretary: [
    'Doctor secretaries use their dashboard for appointments, schedules, approvals, dashboard overview, and patient-record coordination.',
    'Doctor secretary guidance should focus on appointment coordination, doctor schedule support, and patient record routing.'
  ],
  medtech: [
    'Medtech users belong to the clinical staff area and should receive help related to laboratory requests, lab workflow navigation, and clinical task coordination that is visible to their role.',
    'Medtech answers should not claim diagnostic authority and should remain focused on the system workflow.'
  ],
  radiographer: [
    'Radiographers belong to the clinical staff area and should receive help related to imaging workflow, request handling, and assigned page navigation.',
    'Radiographer answers should stay within imaging-related system use and not expose unrelated modules.'
  ],
  ecg_operator: [
    'ECG operators belong to the clinical staff area and should receive help related to ECG task workflow, request visibility, and relevant page actions.',
    'ECG guidance should stay focused on system usage rather than clinical interpretation.'
  ],
  physical_therapist: [
    'Physical therapists belong to the clinical staff area and should receive help related to therapy workflow navigation, task handling, and assigned records inside authorized modules.',
    'Physical therapist answers should stay within system guidance and role-appropriate operational support.'
  ],
  staff: [
    'General staff and office staff use staff-oriented dashboards for operational support tasks and should receive help only for features visible to their role.',
    'General staff answers should remain practical, navigation-focused, and appropriately limited.'
  ],
  patient: [
    'Patient accounts should be handled cautiously and should only receive patient-facing guidance based on visible patient dashboard information and public hospital details.'
  ],
  public: [
    'Public visitors should only receive public website information such as services, contact details, location, visiting hours, and public hospital identity.'
  ]
};

const ROLE_QUICK_ANSWERS = {
  public: {
    'what services does the hospital offer?': 'Pascual General Hospital publicly lists services including medicine, pediatrics, OB-Gyne, dermatology, surgery, orthopedics, anesthesia, radiology, pathology, ophthalmology, ENT, urology, and dental medicine.',
    'where is the hospital located?': 'Pascual General Hospital is located in Novaliches, Quezon City, Metro Manila. The website map points to Pascual General Hospital in Novaliches.',
    'what is the emergency contact number?': 'The contact number shown on the website is 0915 312 7144, and the homepage highlights it for emergency contact as well.',
    'what are your visiting hours?': 'The public homepage states that the hospital is available 24/7 for emergencies. If you need specific visit arrangements beyond that, it is best to contact the hospital directly.',
    'how can i contact the hospital?': 'You can contact Pascual General Hospital through 0915 312 7144 or by email at pascualgenhospi@gmail.com.',
    'what kind of hospital is this?': 'Pascual General Hospital is presented on the website as a private, community-rooted hospital serving families in Novaliches, Quezon City.',
    'is the hospital private or public?': 'The website presents Pascual General Hospital as a private hospital.',
    'can the hospital be trusted?': 'The safest grounded answer is that the website shows visible service information, a public location in Novaliches, Quezon City, published contact details, emergency contact access, and a professional hospital website. Those are public trust indicators, and you may also contact the hospital directly for more information.',
    'what is the hospital history?': 'The public website presents Pascual General Hospital as an established private hospital serving the community, but it does not currently publish a detailed historical timeline. If you need a formal history statement, it is best to request it directly from the hospital.',
    'what facilities does the hospital have?': 'The homepage highlights the hospital environment and facilities through public sections about hospital spaces, care support, and a professional private-hospital setting. For exact room or unit details, it is best to contact the hospital directly.',
    'who does the hospital serve?': 'The website presents Pascual General Hospital as a private community hospital serving families and the surrounding community in Novaliches, Quezon City.',
    'what is this website for?': 'This website is the public-facing online presence of Pascual General Hospital. It helps visitors view hospital information such as services, contact details, location, facilities, updates, and important public information.',
    'what is the hospital mission?': 'The homepage mission statement says: We are committed to deliver optimum holistic patient care by providing accessible, compassionate and quality healthcare.',
    'what is the hospital vision?': 'The homepage vision statement says: To be the ideal God and patient-centered care provider in the community we serve.',
    'what are the hospital core values?': 'The homepage includes a Mission, Vision and Core Values section that presents the hospital as guided by compassionate, accessible, quality, and community-centered healthcare principles.',
    'is the emergency department open 24/7?': 'Yes. The homepage states that the emergency department is staffed 24/7, and it highlights 0915 312 7144 for urgent concerns and emergency coordination.',
    'does the hospital have a pharmacy?': 'Yes. The homepage highlights pharmacy support, safe dispensing, accessible medicine coordination, and convenient service points as part of the hospital environment.',
    'hello': 'Hello! How can I help you today? You can ask about our hospital services, location, contact details, or how our Pascualinga system works.',
    'hi': 'Hi! How can I help you today? You can ask about our hospital services, location, contact details, or how our Pascualinga system works.',
    'hey': 'Hey there! How can I help you? You can ask about our hospital services, location, contact details, or how our Pascualinga system works.',
    'kamusta': 'Hello! Kumusta? Paano ako makakatulong sa iyo ngayon? Maaari kang magtanong tungkol sa aming serbisyo, lokasyon, contact details, o kung paano gamitin ang Pascualinga system.',
    'kumusta': 'Hello! Kumusta? Paano ako makakatulong sa iyo ngayon? Maaari kang magtanong tungkol sa aming serbisyo, lokasyon, contact details, o kung paano gamitin ang Pascualinga system.',
    'good morning': 'Good morning! How can I assist you with Pascual General Hospital today?',
    'good afternoon': 'Good afternoon! How can I assist you with Pascual General Hospital today?',
    'good evening': 'Good evening! How can I assist you with Pascual General Hospital today?',
    'magandang umaga': 'Magandang umaga! Paano kita matutulungan tungkol sa Pascual General Hospital?',
    'magandang hapon': 'Magandang hapon! Paano kita matutulungan tungkol sa Pascual General Hospital?',
    'magandang gabi': 'Magandang gabi! Paano kita matutulungan tungkol sa Pascual General Hospital?',
    'salamat': 'Walang anuman! Masaya akong makatulong. May iba ka pa bang katanungan?',
    'thank you': 'You\'re welcome! I\'m happy to help. Do you have any other questions?',
    'thanks': 'You\'re welcome! I\'m happy to help. Do you have any other questions?'
  },
  admin: {
    'how do i post announcements?': 'Open the admin dashboard and go to the announcements area. From there, create or manage announcements using the admin-only controls, then confirm the post details before saving.',
    'how do i manage staff accounts?': 'Use the admin dashboard staff management section to review, create, edit, or monitor staff accounts and their assigned roles.',
    'how do i change role permissions?': 'Role permissions are handled in the admin settings or role-permission area. Review the target role first, then adjust only the permissions your workflow allows.',
    'what can this system do?': 'The Pascualinga system supports hospital operations through role-based dashboards for administration, clinical workflows, records, announcements, operational monitoring, and public hospital information.'
  },
  doctor: {
    'how do i use the patient queue?': 'Use the doctor dashboard queue area to review assigned patients, open the needed record, then continue with orders, notes, certificates, or approvals from the related tabs.',
    'how do i create orders?': 'Doctors typically create orders from patient-related workflow areas such as labs, imaging, or other clinical request sections visible in the doctor dashboard.',
    'how do i check approvals?': 'Use the doctor approval inbox or related approval section in the doctor dashboard to review requests and respond inside the authorized workflow.',
    'what can this system do?': 'The system helps doctors manage patient queue work, records, orders, approvals, certificates, and related clinical coordination inside the authorized doctor dashboard.'
  },
  nurse: {
    'how do i update patient records?': 'From the nurse-facing patient workflow, open the appropriate patient record and use the fields or sections allowed to nurses. Save only after checking that you are editing the correct patient.',
    'how do i check ward tasks?': 'Use the nurse dashboard or ward-related area to review current tasks, then open the assigned patient or ward item before making updates.',
    'what can this system do?': 'The system helps nurses with patient monitoring, ward-related workflows, and patient record support through the authorized nursing dashboard.'
  },
  pharmacist: {
    'how do i check prescriptions?': 'Use the pharmacist dashboard prescription or dispensing section to review active prescriptions, validate the details, and continue through the authorized dispensing workflow.',
    'how do i use the pharmacy pos?': 'Open the pharmacy POS area from the pharmacist dashboard and process the transaction using the medication and billing information visible to your role.',
    'what can this system do?': 'The system helps pharmacists handle prescriptions, dispensing, stock-related tasks, and pharmacy POS workflows within the authorized pharmacy dashboard.'
  },
  cashier: {
    'how do i check billing records?': 'Use the cashier billing area to search for the patient or transaction, review the billing details, and proceed only with the payment actions available in your module.',
    'how do i update payment status?': 'Open the target billing record in the cashier workflow, confirm the payment details carefully, then update the status using the allowed cashier controls.',
    'what can this system do?': 'The system helps cashiers manage billing, receipts, payment review, and transaction-related workflows through the cashier dashboard.'
  },
  doctor_secretary: {
    'how do i manage doctor appointments?': 'Use the doctor secretary dashboard appointment or schedule section to review booking details, confirm the correct doctor, and update the schedule inside the allowed workflow.',
    'how do i check schedules?': 'The doctor secretary dashboard includes schedule-related views where you can review doctor availability and appointment coordination tasks.',
    'what can this system do?': 'The system helps doctor secretaries coordinate appointments, schedules, approvals, and patient-record routing through the authorized dashboard.'
  },
  medtech: {
    'how do i view lab-related tasks?': 'Open the clinical staff dashboard and go to the area showing assigned laboratory work or requests, then review the task details available to your medtech role.',
    'how do i update request status?': 'Use the request or task section that is visible to medtech users, confirm the request first, then update the status through the allowed controls.',
    'what can this system do?': 'The system helps medtech users review laboratory-related tasks, navigate assigned workflow areas, and update visible request handling steps within their role.'
  },
  radiographer: {
    'how do i view imaging requests?': 'Use the clinical staff dashboard to open the imaging-related task or request area assigned to radiographers, then review the queue visible to your role.',
    'how do i update imaging workflow status?': 'Open the relevant request first, verify the patient and request details, then update status only through the controls available to radiographers.',
    'what can this system do?': 'The system helps radiographers manage imaging-related workflow support, request visibility, and role-appropriate task updates.'
  },
  ecg_operator: {
    'how do i check ecg tasks?': 'Use the clinical staff dashboard to review ECG-related tasks or requests visible to your role, then open the assigned item for more details.',
    'how do i update ecg request status?': 'Open the ECG task entry first, verify the request details, then update the workflow status through the actions visible to ECG operators.',
    'what can this system do?': 'The system helps ECG operators view ECG-related tasks, open assigned work items, and update role-allowed workflow status.'
  },
  physical_therapist: {
    'how do i check therapy-related tasks?': 'Use the clinical staff dashboard to review the therapy-related work assigned to your role, then open the relevant record or task before making updates.',
    'how do i update therapy workflow status?': 'Confirm the correct patient or task entry first, then use the role-allowed workflow actions to update the status.',
    'what can this system do?': 'The system helps physical therapists review therapy-related tasks, navigate assigned workflow items, and make role-appropriate updates.'
  },
  staff: {
    'how do i use this page?': 'Use the visible navigation and role-allowed modules on your current dashboard page. If you tell me which section you are on, I can guide you more precisely.',
    'what can i do in this dashboard?': 'Your dashboard is intended for role-appropriate operational tasks. Tell me the module or page you are currently viewing and I can give focused guidance.',
    'what can this system do?': 'The system supports role-based hospital operations, so your visible dashboard features depend on the office or workflow responsibilities assigned to your account.'
  }
};

const PAGE_GUIDES = [
  { pattern: /^\/$/, note: 'The homepage is public-facing and should focus on services, contact details, location, hospital identity, facilities, and public news.' },
  { pattern: /^\/admin/, note: 'The admin area focuses on staff management, announcements, patients, inventory, analytics, settings, and role permissions.' },
  { pattern: /^\/doctor$/, note: 'The doctor area focuses on patient queue, worklist, records, certificates, labs, approvals, and clinical coordination.' },
  { pattern: /^\/nurse$/, note: 'The nurse area focuses on ward and patient workflow support, patient records, and nursing operations.' },
  { pattern: /^\/pharmacist$/, note: 'The pharmacist area focuses on prescriptions, dispensing, stock, pharmacy POS, and pharmacy workflow management.' },
  { pattern: /^\/cashier$/, note: 'The cashier area focuses on billing, payments, receipts, and transaction-related support.' },
  { pattern: /^\/doctor-secretary$/, note: 'The doctor secretary area focuses on schedules, appointments, patient-record coordination, and approvals.' },
  { pattern: /^\/medtech$/, note: 'The medtech area focuses on laboratory-related workflow guidance and clinical-staff task support.' },
  { pattern: /^\/radiographer$/, note: 'The radiographer area focuses on imaging-related workflow support and request handling.' },
  { pattern: /^\/ecg$/, note: 'The ECG area focuses on ECG-related workflow support and task handling.' },
  { pattern: /^\/pt$/, note: 'The physical therapist area focuses on therapy-related workflow support and assigned task handling.' },
  { pattern: /^\/staff$/, note: 'The general staff area focuses on office and operational workflows visible to staff accounts.' },
  { pattern: /^\/patient$/, note: 'The patient area should stay patient-facing and avoid disclosing internal staff workflows.' }
];

const MEDICAL_RISK_PATTERN = /\b(diagnose|diagnosis|prescribe|prescription for|antibiotic|dosage|dose|what medicine|what drug|treatment for|how to treat|medical advice|what should i take)\b/i;
const OFF_TOPIC_PATTERN = /\b(bitcoin|crypto|stock|forex|president|prime minister|joke|poem|song|homework|math problem|code me a|recipe)\b/i;

function normalizeRole(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'public';
  if (raw.includes('doctor') && raw.includes('secretary')) return 'doctor_secretary';
  if (raw.includes('physical') && raw.includes('therap')) return 'physical_therapist';
  if (raw.includes('radiograph') || raw.includes('x-ray') || raw.includes('xray')) return 'radiographer';
  if (raw.includes('medtech')) return 'medtech';
  if (raw.includes('ecg')) return 'ecg_operator';
  if (raw.includes('cashier')) return 'cashier';
  if (raw.includes('pharmacist')) return 'pharmacist';
  if (raw.includes('nurse')) return 'nurse';
  if (raw.includes('doctor')) return 'doctor';
  if (raw.includes('admin')) return 'admin';
  if (raw.includes('patient')) return 'patient';
  if (raw.includes('staff')) return 'staff';
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'public';
}

function roleLabel(role) {
  const map = {
    public: 'Public visitor',
    admin: 'Administrator',
    doctor: 'Doctor',
    nurse: 'Nurse',
    pharmacist: 'Pharmacist',
    cashier: 'Cashier',
    doctor_secretary: 'Doctor Secretary',
    medtech: 'Medtech',
    radiographer: 'Radiographer',
    ecg_operator: 'ECG Operator',
    physical_therapist: 'Physical Therapist',
    staff: 'Staff',
    patient: 'Patient'
  };
  return map[role] || 'User';
}

function pageGuide(pathname) {
  const path = String(pathname || '/').trim() || '/';
  const found = PAGE_GUIDES.find((entry) => entry.pattern.test(path));
  return found ? found.note : 'The assistant should stay focused on the current system page and the user role.';
}

function normalizeQuestionText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/what's/g, 'what is')
    .replace(/whats/g, 'what is')
    .replace(/where's/g, 'where is')
    .replace(/wheres/g, 'where is')
    .replace(/how's/g, 'how is')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAll(text, words) {
  return words.every((word) => text.includes(word));
}

function detectPublicIntent(normalized) {
  if (!normalized) return '';

  if (
    (normalized.includes('service') || normalized.includes('department')) &&
    (normalized.includes('offer') || normalized.includes('available') || normalized.includes('provide') || normalized.includes('have'))
  ) {
    return 'what services does the hospital offer?';
  }

  if (
    (normalized.includes('where is') || normalized.includes('location') || normalized.includes('located') || normalized.includes('address')) &&
    (normalized.includes('hospital') || normalized.includes('pascual'))
  ) {
    return 'where is the hospital located?';
  }

  if (
    (normalized.includes('emergency') || normalized.includes('urgent')) &&
    (normalized.includes('contact') || normalized.includes('number') || normalized.includes('phone') || normalized.includes('call'))
  ) {
    return 'what is the emergency contact number?';
  }

  if (
    (normalized.includes('visiting') || normalized.includes('visit')) &&
    (normalized.includes('hour') || normalized.includes('time') || normalized.includes('schedule'))
  ) {
    return 'what are your visiting hours?';
  }

  if (
    (normalized.includes('contact') || normalized.includes('reach')) &&
    (normalized.includes('hospital') || normalized.includes('email') || normalized.includes('phone') || normalized.includes('call'))
  ) {
    return 'how can i contact the hospital?';
  }

  if (
    (normalized.includes('private') || normalized.includes('public') || normalized.includes('kind of hospital') || normalized.includes('type of hospital')) &&
    normalized.includes('hospital')
  ) {
    return 'is the hospital private or public?';
  }

  if (
    normalized.includes('trust') ||
    normalized.includes('trusted') ||
    normalized.includes('reliable') ||
    (normalized.includes('can') && normalized.includes('hospital') && normalized.includes('trusted'))
  ) {
    return 'can the hospital be trusted?';
  }

  if (
    normalized.includes('history') ||
    normalized.includes('background') ||
    (normalized.includes('about') && normalized.includes('hospital'))
  ) {
    return normalized.includes('history') || normalized.includes('background')
      ? 'what is the hospital history?'
      : 'what kind of hospital is this?';
  }

  if (
    normalized.includes('facility') ||
    normalized.includes('facilities') ||
    normalized.includes('room') ||
    normalized.includes('environment')
  ) {
    return 'what facilities does the hospital have?';
  }

  if (
    normalized.includes('mission') &&
    (normalized.includes('hospital') || normalized.includes('pascual'))
  ) {
    return 'what is the hospital mission?';
  }

  if (
    normalized.includes('vision') &&
    (normalized.includes('hospital') || normalized.includes('pascual'))
  ) {
    return 'what is the hospital vision?';
  }

  if (
    normalized.includes('core values') ||
    (normalized.includes('values') && (normalized.includes('hospital') || normalized.includes('pascual')))
  ) {
    return 'what are the hospital core values?';
  }

  if (
    (normalized.includes('emergency department') || normalized.includes('er') || normalized.includes('emergency room')) &&
    (normalized.includes('open') || normalized.includes('24 7') || normalized.includes('24') || normalized.includes('available'))
  ) {
    return 'is the emergency department open 24/7?';
  }

  if (
    normalized.includes('pharmacy') &&
    (normalized.includes('have') || normalized.includes('does') || normalized.includes('support') || normalized.includes('available'))
  ) {
    return 'does the hospital have a pharmacy?';
  }

  if (
    normalized.includes('serve') ||
    normalized.includes('community') ||
    normalized.includes('family') ||
    normalized.includes('who is this hospital for')
  ) {
    return 'who does the hospital serve?';
  }

  if (
    (normalized.includes('website') || normalized.includes('site')) &&
    (normalized.includes('for') || normalized.includes('purpose') || normalized.includes('about'))
  ) {
    return 'what is this website for?';
  }

  if (
    normalized.includes('system') ||
    normalized.includes('platform') ||
    normalized.includes('how it works') ||
    normalized.includes('paano gamitin') ||
    normalized.includes('how to use') ||
    normalized.includes('whole system')
  ) {
    return 'what can this system do?';
  }

  return '';
}

function detectRoleIntent(role, normalized) {
  if (!normalized) return '';

  if (role === 'admin') {
    if (includesAll(normalized, ['announcement']) && (normalized.includes('post') || normalized.includes('create') || normalized.includes('add'))) {
      return 'how do i post announcements?';
    }
    if (normalized.includes('staff') && (normalized.includes('manage') || normalized.includes('account') || normalized.includes('user'))) {
      return 'how do i manage staff accounts?';
    }
    if (normalized.includes('role') && (normalized.includes('permission') || normalized.includes('access'))) {
      return 'how do i change role permissions?';
    }
  }

  if (role === 'doctor') {
    if (normalized.includes('patient queue') || (normalized.includes('queue') && normalized.includes('patient'))) {
      return 'how do i use the patient queue?';
    }
    if (normalized.includes('order') || normalized.includes('orders')) {
      return 'how do i create orders?';
    }
    if (normalized.includes('approval') || normalized.includes('approvals')) {
      return 'how do i check approvals?';
    }
  }

  if (role === 'nurse') {
    if (normalized.includes('patient record') || (normalized.includes('record') && normalized.includes('patient'))) {
      return 'how do i update patient records?';
    }
    if (normalized.includes('ward') || normalized.includes('task')) {
      return 'how do i check ward tasks?';
    }
  }

  if (role === 'pharmacist') {
    if (normalized.includes('prescription')) return 'how do i check prescriptions?';
    if (normalized.includes('pos') || normalized.includes('pharmacy')) return 'how do i use the pharmacy pos?';
  }

  if (role === 'cashier') {
    if (normalized.includes('billing') || normalized.includes('bill')) return 'how do i check billing records?';
    if ((normalized.includes('payment') || normalized.includes('paid')) && normalized.includes('status')) return 'how do i update payment status?';
  }

  if (role === 'doctor_secretary') {
    if (normalized.includes('appointment')) return 'how do i manage doctor appointments?';
    if (normalized.includes('schedule')) return 'how do i check schedules?';
  }

  if (role === 'medtech') {
    if (normalized.includes('lab') || normalized.includes('laboratory')) return 'how do i view lab-related tasks?';
    if (normalized.includes('request') && normalized.includes('status')) return 'how do i update request status?';
  }

  if (role === 'radiographer') {
    if (normalized.includes('imaging') || normalized.includes('radiograph') || normalized.includes('xray') || normalized.includes('x ray')) {
      if (normalized.includes('status')) return 'how do i update imaging workflow status?';
      return 'how do i view imaging requests?';
    }
  }

  if (role === 'ecg_operator') {
    if (normalized.includes('ecg')) {
      if (normalized.includes('status')) return 'how do i update ecg request status?';
      return 'how do i check ecg tasks?';
    }
  }

  if (role === 'physical_therapist') {
    if (normalized.includes('therapy') || normalized.includes('physical therapist') || normalized.includes('pt ')) {
      if (normalized.includes('status')) return 'how do i update therapy workflow status?';
      return 'how do i check therapy-related tasks?';
    }
  }

  if (role === 'staff') {
    if (normalized.includes('use this page') || (normalized.includes('how') && normalized.includes('page'))) {
      return 'how do i use this page?';
    }
    if (normalized.includes('dashboard') && (normalized.includes('what can i do') || normalized.includes('what can do') || normalized.includes('can i do'))) {
      return 'what can i do in this dashboard?';
    }
  }

  if (
    normalized.includes('what can this system do') ||
    normalized.includes('what does this system do') ||
    normalized.includes('what is this system') ||
    normalized.includes('what is pascualinga') ||
    ((normalized.includes('system') || normalized.includes('platform') || normalized.includes('dashboard')) &&
      (normalized.includes('purpose') || normalized.includes('for') || normalized.includes('do')))
  ) {
    return 'what can this system do?';
  }

  return '';
}

function knowledgeEntriesForRole(role, pathname) {
  const entries = PUBLIC_KNOWLEDGE.map((item) => ({ ...item, audience: 'public' }));

  // Always include system knowledge so the AI can explain the whole system even to public users
  SYSTEM_KNOWLEDGE.forEach((item) => entries.push({ ...item, audience: 'internal' }));

  if (role !== 'public') {
    (ROLE_GUIDES[role] || ROLE_GUIDES.staff || []).forEach((text, index) => {
      entries.push({
        id: `${role}-guide-${index + 1}`,
        title: `${roleLabel(role)} guidance`,
        text,
        audience: role
      });
    });
    entries.push({
      id: `${role}-page-guide`,
      title: `${roleLabel(role)} page guidance`,
      text: pageGuide(pathname),
      audience: role
    });
  }

  return entries;
}

function keywordTokens(value) {
  const STOPWORDS = new Set([
    'the', 'is', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'by', 'be', 'it', 'this',
    'that', 'do', 'does', 'can', 'i', 'we', 'you', 'your', 'our', 'are', 'about', 'how', 'what', 'where',
    'when', 'who', 'why', 'from', 'with', 'have', 'has', 'had', 'please', 'tell'
  ]);

  return normalizeQuestionText(value)
    .split(' ')
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function bestKnowledgeMatch(role, pathname, text) {
  const tokens = keywordTokens(text);
  if (!tokens.length) return null;

  const entries = knowledgeEntriesForRole(role, pathname);
  let best = null;

  entries.forEach((entry) => {
    const haystack = normalizeQuestionText(`${entry.title} ${entry.text}`);
    let score = 0;

    tokens.forEach((token) => {
      if (haystack.includes(token)) score += token.length > 6 ? 3 : 2;
    });

    if (normalizeQuestionText(text).includes('trust') && entry.id.includes('trust')) score += 4;
    if (normalizeQuestionText(text).includes('history') && entry.id.includes('history')) score += 4;
    if (normalizeQuestionText(text).includes('facility') && entry.id.includes('facilities')) score += 4;
    if (normalizeQuestionText(text).includes('system') && entry.id.startsWith('system-')) score += 4;
    if (normalizeQuestionText(text).includes('mission') && entry.id.includes('mission')) score += 4;
    if (normalizeQuestionText(text).includes('vision') && entry.id.includes('vision')) score += 4;
    if (normalizeQuestionText(text).includes('value') && entry.id.includes('values')) score += 4;
    if (normalizeQuestionText(text).includes('pharmacy') && entry.id.includes('pharmacy')) score += 4;
    if (normalizeQuestionText(text).includes('emergency') && entry.id.includes('emergency')) score += 4;

    if (!best || score > best.score) {
      best = { entry, score };
    }
  });

  return best && best.score >= 4 ? best.entry : null;
}

function quickAnswerFor(role, text) {
  const normalized = normalizeQuestionText(text);
  const pool = ROLE_QUICK_ANSWERS[role] || ROLE_QUICK_ANSWERS.public;
  if (pool[normalized]) return pool[normalized];

  const roleIntent = detectRoleIntent(role, normalized);
  if (roleIntent && pool[roleIntent]) return pool[roleIntent];

  const publicIntent = detectPublicIntent(normalized);
  if (publicIntent && ROLE_QUICK_ANSWERS.public[publicIntent]) return ROLE_QUICK_ANSWERS.public[publicIntent];

  if (role !== 'public' && ROLE_QUICK_ANSWERS.public[normalized]) return ROLE_QUICK_ANSWERS.public[normalized];
  return '';
}

function detectAssistantCapabilityIntent(text) {
  const normalized = normalizeQuestionText(text);
  if (!normalized) return '';

  const mentionsTagalog =
    /\b(tagalog|taglish|filipino)\b/i.test(text) ||
    normalized.includes('nagtatagalog') ||
    normalized.includes('nag tatagalog') ||
    normalized.includes('mag tagalog') ||
    normalized.includes('magtagalog');

  const asksTagalog =
    mentionsTagalog &&
    (
      normalized.includes('can you') ||
      normalized.includes('do you') ||
      normalized.includes('nagtatagalog') ||
      normalized.includes('marunong') ||
      normalized.includes('pwede') ||
      normalized.includes('puwede') ||
      normalized.includes('speak')
    );

  if (asksTagalog) return 'language';

  const asksCapabilities =
    normalized.includes('what can you do') ||
    normalized.includes('what can u do') ||
    normalized.includes('ano kaya mong gawin') ||
    normalized.includes('anong kaya mong gawin') ||
    normalized.includes('paano ka makakatulong') ||
    normalized.includes('how can you help') ||
    normalized.includes('what can i ask') ||
    normalized.includes('ano ang pwede kong itanong') ||
    normalized.includes('anong pwede kong itanong');

  if (asksCapabilities) return 'capabilities';

  return '';
}

function assistantCapabilityReply({ role, preferredLanguage, intent }) {
  if (!intent) return '';

  if (intent === 'language') {
    return preferredLanguage === 'tagalog'
      ? 'Oo, puwede akong sumagot sa Tagalog o Taglish. Kapag Tagalog ang tanong mo, sasagutin din kita sa Tagalog basta tungkol ito sa hospital information o sa tamang system workflow.'
      : 'Yes. I can reply in Tagalog or Taglish when you ask in Tagalog, as long as the question is about hospital information or the appropriate system workflow.';
  }

  if (intent === 'capabilities') {
    if (role === 'public') {
      return preferredLanguage === 'tagalog'
        ? 'Makakatulong ako sa public hospital information tulad ng services, location, contact details, visiting information, emergency contact, facilities, at public updates. Puwede mo rin akong tanungin tungkol sa website sections ng ospital.'
        : 'I can help with public hospital information such as services, location, contact details, visiting information, emergency contact, facilities, public updates, and guidance about the hospital website sections.';
    }

    return preferredLanguage === 'tagalog'
      ? `Makakatulong ako sa public hospital information at sa tamang workflow para sa ${roleLabel(role)} account mo. Puwede mo akong tanungin tungkol sa modules, steps, navigation, at role-appropriate tasks sa page na gamit mo ngayon.`
      : `I can help with public hospital information and the appropriate workflow for your ${roleLabel(role)} account. You can ask me about modules, steps, navigation, and role-appropriate tasks on the page you are using now.`;
  }

  return '';
}

function gatherContext(role, pathname) {
  const parts = [];
  if (role === 'public') {
    PUBLIC_KNOWLEDGE.forEach((item) => parts.push(`${item.title}: ${item.text}`));
  } else {
    SYSTEM_KNOWLEDGE.forEach((item) => parts.push(`${item.title}: ${item.text}`));
    PUBLIC_KNOWLEDGE.forEach((item) => parts.push(`${item.title}: ${item.text}`));
    ROLE_GUIDES.public.forEach((line) => parts.push(line));
    (ROLE_GUIDES[role] || ROLE_GUIDES.staff || []).forEach((line) => parts.push(line));
  }
  parts.push(`Page guidance: ${pageGuide(pathname)}`);
  return parts.join('\n');
}

function safeReply(message) {
  return {
    answer: message,
    source: 'policy',
    grounded: true,
    suggestions: []
  };
}

function detectPreferredLanguage(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'english';
  const lower = raw.toLowerCase();
  if (/\b(tagalog|taglish|filipino|nagtatagalog|magtagalog|mag tagalog)\b/i.test(raw)) return 'tagalog';
  const tagalogSignals = [
    ' ano ', ' paano ', ' bakit ', ' saan ', ' kailan ', ' sino ', ' pwede ', ' puwede ',
    ' gusto ', ' ko ', ' mo ', ' nyo ', ' ninyo ', ' natin ', ' natin ', ' ito ', ' iyan ',
    ' dito ', ' doon ', ' na ', ' pa ', ' ba ', ' naman ', ' kasi ', ' po ', ' opo ',
    ' salamat ', ' kamusta ', ' magkano ', ' kailangan ', ' sabihin ', ' paki ', ' please ',
    ' taga', ' tagalog ', ' filipino ', ' ingles ', ' ilagay ', ' gawin ', ' ayaw ', ' meron ',
    ' wala ', ' nasa ', ' para ', ' kapag ', ' habang ', ' galing ', ' lahat ', ' side '
  ];

  let score = 0;
  const padded = ` ${lower} `;
  tagalogSignals.forEach((signal) => {
    if (padded.includes(signal)) score += 1;
  });

  if (/[ñ]/i.test(raw)) score += 1;
  if (/\b(ng|mga|yung|lang|naman|talaga|sige|okay|ayos)\b/i.test(raw)) score += 2;

  return score >= 2 ? 'tagalog' : 'english';
}

function localizeAssistantText(message, preferredLanguage, role) {
  if (preferredLanguage !== 'tagalog') return message;

  const text = String(message || '').trim();
  const translations = new Map([
    [
      'Please ask a question related to Pascual General Hospital information or your authorized system workflow.',
      'Magtanong lang tungkol sa impormasyon ng Pascual General Hospital o sa workflow na pinapayagan para sa account mo sa system.'
    ],
    [
      'I can help with Pascual General Hospital information and system guidance, but I cannot provide diagnosis, treatment, or prescription advice. For urgent medical concerns, please contact the hospital directly at 0915 312 7144 or seek immediate professional care.',
      'Makakatulong ako sa impormasyon tungkol sa Pascual General Hospital at sa paggamit ng system, pero hindi ako puwedeng magbigay ng diagnosis, treatment, o prescription advice. Kung urgent ang concern, tumawag agad sa ospital sa 0915 312 7144 o maghanap ng agarang professional care.'
    ],
    [
      'I can help only with Pascual General Hospital information and role-appropriate system guidance. If you need help with services, contact details, or your current workflow, ask me about that instead.',
      'Makakatulong lang ako sa impormasyon tungkol sa Pascual General Hospital at sa tamang system guidance para sa role mo. Kung kailangan mo ng tulong sa services, contact details, o sa current workflow mo, iyon ang itanong mo.'
    ],
    [
      'I can help with hospital services, location, contact details, visiting information, emergency contact, hospital background, trust-related public information, facilities, and public updates. Please ask about one of those topics so I can give a grounded answer.',
      'Makakatulong ako tungkol sa hospital services, lokasyon, contact details, visiting information, emergency contact, background ng ospital, public trust information, facilities, at public updates. Magtanong ka tungkol sa isa sa mga iyon para makapagbigay ako ng tamang sagot.'
    ],
    [
      'Pascual General Hospital publicly lists services including medicine, pediatrics, OB-Gyne, dermatology, surgery, orthopedics, anesthesia, radiology, pathology, ophthalmology, ENT, urology, and dental medicine.',
      'Ayon sa public website, ang Pascual General Hospital ay may mga serbisyong kabilang ang medicine, pediatrics, OB-Gyne, dermatology, surgery, orthopedics, anesthesia, radiology, pathology, ophthalmology, ENT, urology, at dental medicine.'
    ],
    [
      'Pascual General Hospital is located in Novaliches, Quezon City, Metro Manila. The website map points to Pascual General Hospital in Novaliches.',
      'Ang Pascual General Hospital ay matatagpuan sa Novaliches, Quezon City, Metro Manila. Iyon din ang lokasyong ipinapakita sa website map.'
    ],
    [
      'The contact number shown on the website is 0915 312 7144, and the homepage highlights it for emergency contact as well.',
      'Ang contact number na nakalagay sa website ay 0915 312 7144, at naka-highlight din ito sa homepage bilang emergency contact.'
    ],
    [
      'The public homepage states that the hospital is available 24/7 for emergencies. If you need specific visit arrangements beyond that, it is best to contact the hospital directly.',
      'Ayon sa public homepage, available ang ospital 24/7 para sa emergencies. Kung kailangan mo ng mas specific na visiting arrangement, mas mabuting direktang kontakin ang ospital.'
    ],
    [
      'You can contact Pascual General Hospital through 0915 312 7144 or by email at pascualgenhospi@gmail.com.',
      'Maaari mong kontakin ang Pascual General Hospital sa 0915 312 7144 o sa email na pascualgenhospi@gmail.com.'
    ],
    [
      'Pascual General Hospital is presented on the website as a private, community-rooted hospital serving families in Novaliches, Quezon City.',
      'Ipinapakita sa website ang Pascual General Hospital bilang isang private, community-rooted hospital na nagsisilbi sa mga pamilya sa Novaliches, Quezon City.'
    ],
    [
      'The safest grounded answer is that the website shows visible service information, a public location in Novaliches, Quezon City, published contact details, emergency contact access, and a professional hospital website. Those are public trust indicators, and you may also contact the hospital directly for more information.',
      'Ang pinakaligtas na grounded answer ay ipinapakita ng website ang malinaw na service information, public location sa Novaliches, Quezon City, published contact details, emergency contact access, at professional hospital website. Mga public trust indicators ang mga iyon, at puwede mo ring direktang kontakin ang ospital para sa dagdag na impormasyon.'
    ],
    [
      'The public website presents Pascual General Hospital as an established private hospital serving the community, but it does not currently publish a detailed historical timeline. If you need a formal history statement, it is best to request it directly from the hospital.',
      'Ipinapakita ng public website ang Pascual General Hospital bilang isang established private hospital na nagsisilbi sa komunidad, pero wala pa itong detalyadong historical timeline na naka-publish. Kung kailangan mo ng formal history statement, mas mabuting hingin ito diretso sa ospital.'
    ],
    [
      'The homepage highlights the hospital environment and facilities through public sections about hospital spaces, care support, and a professional private-hospital setting. For exact room or unit details, it is best to contact the hospital directly.',
      'Itinatampok ng homepage ang hospital environment at facilities sa pamamagitan ng public sections tungkol sa hospital spaces, care support, at professional private-hospital setting. Para sa eksaktong room o unit details, mas mabuting direktang kontakin ang ospital.'
    ],
    [
      'The website presents Pascual General Hospital as a private community hospital serving families and the surrounding community in Novaliches, Quezon City.',
      'Ipinapakita ng website ang Pascual General Hospital bilang isang private community hospital na nagsisilbi sa mga pamilya at kalapit na komunidad sa Novaliches, Quezon City.'
    ],
    [
      'This website is the public-facing online presence of Pascual General Hospital. It helps visitors view hospital information such as services, contact details, location, facilities, updates, and important public information.',
      'Ang website na ito ang public-facing online presence ng Pascual General Hospital. Tinutulungan nito ang mga bisita na makita ang hospital information gaya ng services, contact details, location, facilities, updates, at iba pang importanteng public information.'
    ],
    [
      'The homepage mission statement says: We are committed to deliver optimum holistic patient care by providing accessible, compassionate and quality healthcare.',
      'Ayon sa mission statement sa homepage: We are committed to deliver optimum holistic patient care by providing accessible, compassionate and quality healthcare.'
    ],
    [
      'The homepage vision statement says: To be the ideal God and patient-centered care provider in the community we serve.',
      'Ayon sa vision statement sa homepage: To be the ideal God and patient-centered care provider in the community we serve.'
    ],
    [
      'The homepage includes a Mission, Vision and Core Values section that presents the hospital as guided by compassionate, accessible, quality, and community-centered healthcare principles.',
      'May Mission, Vision and Core Values section ang homepage na nagpapakita na ang ospital ay ginagabayan ng compassionate, accessible, quality, at community-centered healthcare principles.'
    ],
    [
      'Yes. The homepage states that the emergency department is staffed 24/7, and it highlights 0915 312 7144 for urgent concerns and emergency coordination.',
      'Oo. Sinasabi ng homepage na may staff ang emergency department 24/7, at naka-highlight din ang 0915 312 7144 para sa urgent concerns at emergency coordination.'
    ],
    [
      'Yes. The homepage highlights pharmacy support, safe dispensing, accessible medicine coordination, and convenient service points as part of the hospital environment.',
      'Oo. Itinatampok ng homepage ang pharmacy support, safe dispensing, accessible medicine coordination, at convenient service points bilang bahagi ng hospital environment.'
    ],
    [
      'Pascual General Hospital publicly highlights medicine, pediatrics, obstetrics and gynecology, dermatology, surgery, orthopedics, anesthesia, radiology, pathology, ophthalmology, otolaryngology, urology, and dental medicine.',
      'Sa public website, itinatampok ng Pascual General Hospital ang medicine, pediatrics, obstetrics and gynecology, dermatology, surgery, orthopedics, anesthesia, radiology, pathology, ophthalmology, otolaryngology, urology, at dental medicine.'
    ],
    [
      'The public contact details shown on the website include the emergency and contact number 0915 312 7144, the email address pascualgenhospi@gmail.com, and the location Pascual General Hospital, Novaliches, Quezon City, Metro Manila.',
      'Kasama sa public contact details na nakalagay sa website ang emergency at contact number na 0915 312 7144, ang email na pascualgenhospi@gmail.com, at ang lokasyong Pascual General Hospital, Novaliches, Quezon City, Metro Manila.'
    ],
    [
      'The website says the hospital is available 24/7 for emergencies and encourages visitors to use the emergency contact number for urgent needs.',
      'Ayon sa website, available ang ospital 24/7 para sa emergencies at hinihikayat ang mga bisita na gamitin ang emergency contact number para sa urgent needs.'
    ],
    [
      'The homepage presents Pascual General Hospital as a private, community-rooted hospital focused on compassionate care, organized services, and professional support for families.',
      'Ipinapakita ng homepage ang Pascual General Hospital bilang isang private, community-rooted hospital na nakatuon sa compassionate care, organized services, at professional support para sa mga pamilya.'
    ],
    [
      'Public trust indicators shown on the website include clearly published contact details, a physical location in Novaliches, Quezon City, visible service information, emergency contact access, and a professional public-facing hospital website.',
      'Kasama sa public trust indicators na makikita sa website ang malinaw na published contact details, physical location sa Novaliches, Quezon City, visible service information, emergency contact access, at professional public-facing hospital website.'
    ],
    [
      'The public website presents Pascual General Hospital as an established private hospital serving the community, but it does not publish a detailed long-form historical timeline. The assistant should explain only that public identity unless more official history is added to the site.',
      'Ipinapakita ng public website ang Pascual General Hospital bilang isang established private hospital na nagsisilbi sa komunidad, pero wala itong detalyadong long-form historical timeline na naka-publish. Hanggang doon lang dapat ang ipaliwanag ng assistant maliban kung may mas official history pang maidagdag sa site.'
    ],
    [
      'The homepage highlights the hospital environment and facilities through public sections about hospital spaces, care support, and a professional private-hospital setting intended to make visitors feel informed and reassured.',
      'Itinatampok ng homepage ang hospital environment at facilities sa pamamagitan ng public sections tungkol sa hospital spaces, care support, at professional private-hospital setting na layong magbigay ng impormasyon at reassurance sa mga bisita.'
    ],
    [
      'The homepage highlights pharmacy support, accessible medicine coordination, safe dispensing, and convenient service points as part of the public-facing hospital experience.',
      'Itinatampok ng homepage ang pharmacy support, accessible medicine coordination, safe dispensing, at convenient service points bilang bahagi ng public-facing hospital experience.'
    ],
    [
      'The website presents Pascual General Hospital as a private hospital that serves families and the surrounding community in Novaliches, Quezon City with accessible information, organized care, and emergency readiness.',
      'Ipinapakita ng website ang Pascual General Hospital bilang isang private hospital na nagsisilbi sa mga pamilya at kalapit na komunidad sa Novaliches, Quezon City sa pamamagitan ng accessible information, organized care, at emergency readiness.'
    ],
    [
      'The homepage says the emergency department is staffed 24/7 and highlights 0915 312 7144 as the emergency contact number for urgent concerns and immediate coordination.',
      'Ayon sa homepage, may staff ang emergency department 24/7 at naka-highlight ang 0915 312 7144 bilang emergency contact number para sa urgent concerns at immediate coordination.'
    ],
    [
      'The homepage includes real health and public-interest news links and official hospital updates, but the assistant should only summarize what is publicly available and should not invent unpublished announcements.',
      'May real health and public-interest news links at official hospital updates ang homepage, pero dapat ang assistant ay nagbubuod lang ng publicly available na impormasyon at hindi gumagawa ng unpublished announcements.'
    ],
    [
      'The Pascualinga platform combines a public hospital website with role-based internal dashboards so visitors can access hospital information while authorized users can manage operational, administrative, and clinical workflows.',
      'Ang Pascualinga platform ay kombinasyon ng public hospital website at mga role-based internal dashboards. Dito, ang mga bisita ay makakakita ng impormasyon tungkol sa ospital, habang ang mga authorized users naman ay nakakapamahala ng operational, administrative, at clinical workflows gaya ng ER Intake, Bed Map, at Patient Records.'
    ],
    [
      'The internal system is designed for role-based use by administrators, doctors, nurses, pharmacists, cashiers, doctor secretaries, medtechs, radiographers, ECG operators, physical therapists, general staff, and patient-facing accounts where applicable.',
      'Ang system ay dinesenyo para sa iba\'t ibang roles gaya ng Admin, Doctor, Nurse, Pharmacist, Cashier, Medtech, at iba pa. Bawat role ay may kani-kaniyang dashboard para sa mas mabilis at organized na trabaho sa ospital.'
    ],
    [
      'The admin side of the system includes dashboards for announcements, staff management, inventory, analytics, settings, role permissions, and operational monitoring.',
      'Sa Admin side, may mga dashboard para sa announcements, staff management, inventory, analytics, settings, at monitoring ng buong operations ng ospital.'
    ],
    [
      'The clinical side of the system supports patient queue handling, records, requests, approvals, laboratory and imaging task visibility, prescriptions, and role-specific workflow coordination.',
      'Sa Clinical side naman, sinusuportahan nito ang patient queue, records, requests, approvals, at ang laboratory/imaging tasks para sa mas mabilis na serbisyo sa pasyente.'
    ],
    [
      'The system helps doctors manage patient queue work, records, orders, approvals, certificates, and related clinical coordination inside the authorized doctor dashboard.',
      'Tinutulungan ng system ang mga doctor sa patient queue work, records, orders, approvals, certificates, at kaugnay na clinical coordination sa loob ng authorized doctor dashboard.'
    ],
    [
      'The system helps nurses with patient monitoring, ward-related workflows, and patient record support through the authorized nursing dashboard.',
      'Tinutulungan ng system ang mga nurse sa patient monitoring, ward-related workflows, at patient record support sa loob ng authorized nursing dashboard.'
    ],
    [
      'The system helps pharmacists handle prescriptions, dispensing, stock-related tasks, and pharmacy POS workflows within the authorized pharmacy dashboard.',
      'Tinutulungan ng system ang mga pharmacist sa prescriptions, dispensing, stock-related tasks, at pharmacy POS workflows sa loob ng authorized pharmacy dashboard.'
    ],
    [
      'The system helps cashiers manage billing, receipts, payment review, and transaction-related workflows through the cashier dashboard.',
      'Tinutulungan ng system ang mga cashier sa billing, receipts, payment review, at transaction-related workflows sa cashier dashboard.'
    ],
    [
      'The system helps doctor secretaries coordinate appointments, schedules, approvals, and patient-record routing through the authorized dashboard.',
      'Tinutulungan ng system ang mga doctor secretary sa coordination ng appointments, schedules, approvals, at patient-record routing sa authorized dashboard.'
    ]
  ]);

  if (translations.has(text)) return translations.get(text);

  if (text.startsWith('I can help as your ') && text.includes(' assistant for Pascual General Hospital system use.')) {
    return `Makakatulong ako bilang ${roleLabel(role)} assistant mo para sa paggamit ng system ng Pascual General Hospital. Sabihin mo lang kung anong module o task ang ginagawa mo sa page na ito at gagabayan kita gamit ang tamang steps para sa role mo.`;
  }

  return text;
}

function resolveReplyLanguage(text, preferredLanguage) {
  if (preferredLanguage === 'tagalog') return 'tagalog';
  return detectPreferredLanguage(text) === 'tagalog' ? 'tagalog' : 'english';
}

function localAssistantReply({ role, message, pathname, preferredLanguage = 'english' }) {
  const text = String(message || '').trim();
  const effectiveLanguage = resolveReplyLanguage(text, preferredLanguage);
  if (!text) {
    return safeReply(localizeAssistantText('Please ask a question related to Pascual General Hospital information or your authorized system workflow.', effectiveLanguage, role));
  }

  const normalized = normalizeQuestionText(text);
  const isGreeting =
    normalized === 'hello' ||
    normalized === 'hi' ||
    normalized === 'hey' ||
    normalized === 'good morning' ||
    normalized === 'good afternoon' ||
    normalized === 'good evening' ||
    normalized === 'kamusta' ||
    normalized === 'kumusta' ||
    normalized === 'hello po' ||
    normalized === 'hi po' ||
    normalized === 'hey po' ||
    normalized === 'salamat' ||
    normalized === 'thank you' ||
    normalized === 'thanks' ||
    normalized === 'magandang umaga' ||
    normalized === 'magandang hapon' ||
    normalized === 'magandang gabi';

  if (isGreeting) {
    const greetingKey = normalized.includes('salamat') || normalized.includes('thank') ? 'thank you' : (normalized.includes('kamusta') || normalized.includes('kumusta') ? 'kamusta' : (normalized.includes('umaga') ? 'magandang umaga' : (normalized.includes('hapon') ? 'magandang hapon' : (normalized.includes('gabi') ? 'magandang gabi' : 'hello'))));
    
    // For local fallback, we pick the best translation from our pool
    const pool = ROLE_QUICK_ANSWERS.public;
    const answer = pool[normalized] || pool[greetingKey] || pool['hello'];

    return {
      answer: localizeAssistantText(answer, effectiveLanguage, role),
      source: 'knowledge',
      grounded: true,
      suggestions: role === 'public'
        ? ['Services', 'Location', 'Contact details', 'Emergency number', 'How the system works']
        : ['Appointments', 'Billing', 'Patients', 'Inventory', 'Announcements']
    };
  }

  const capabilityIntent = detectAssistantCapabilityIntent(text);
  if (capabilityIntent) {
    return {
      answer: assistantCapabilityReply({ role, preferredLanguage: effectiveLanguage, intent: capabilityIntent }),
      source: 'knowledge',
      grounded: true,
      suggestions: role === 'public'
        ? ['Where are you located?', 'Emergency contact number', 'What services do you offer?', 'How can I contact the hospital?']
        : ['How do I use this module?', 'What is the next step?', 'Where can I find this feature?']
    };
  }

  if (MEDICAL_RISK_PATTERN.test(text)) {
    return safeReply(localizeAssistantText('I can help with Pascual General Hospital information and system guidance, but I cannot provide diagnosis, treatment, or prescription advice. For urgent medical concerns, please contact the hospital directly at 0915 312 7144 or seek immediate professional care.', effectiveLanguage, role));
  }

  if (OFF_TOPIC_PATTERN.test(text)) {
    return safeReply(localizeAssistantText('I can help only with Pascual General Hospital information and role-appropriate system guidance. If you need help with services, contact details, or your current workflow, ask me about that instead.', effectiveLanguage, role));
  }

  const quick = quickAnswerFor(role, text);
  if (quick) {
    return {
      answer: localizeAssistantText(quick, effectiveLanguage, role),
      source: 'knowledge',
      grounded: true,
      suggestions: role === 'public'
        ? ['Services', 'Location', 'Contact details', 'Emergency number', 'Public updates']
        : ['Appointments', 'Billing', 'Patients', 'Inventory', 'Announcements']
    };
  }

  const groundedMatch = bestKnowledgeMatch(role, pathname, text);
  if (groundedMatch) {
    return {
      answer: localizeAssistantText(groundedMatch.text, effectiveLanguage, role),
      source: 'knowledge',
      grounded: true,
      suggestions: role === 'public'
        ? ['Emergency contact number', 'Location', 'Contact details', 'Services', 'Updates']
        : ['Next step', 'Where is this module?', 'What can I do here?']
    };
  }

  if (role === 'public') {
    return {
      answer: localizeAssistantText(
        'I can help with hospital services, location, contact details, visiting information, emergency contact, facilities, billing/payment process (general), and public updates. Which one do you need?\n\nExamples:\n- “Where is the hospital located?”\n- “What is the emergency number?”\n- “What services do you offer?”\n- “How can I contact the hospital?”',
        effectiveLanguage,
        role
      ),
      source: 'knowledge',
      grounded: true,
      suggestions: ['Services', 'Location', 'Contact details', 'Emergency number', 'Public updates']
    };
  }

  return {
    answer: localizeAssistantText(`I can help as your ${roleLabel(role)} assistant for Pascual General Hospital system use. If you tell me the module or task you are trying to do on this page, I can guide you using role-appropriate instructions.`, effectiveLanguage, role),
    source: 'knowledge',
    grounded: true,
    suggestions: ['Appointments', 'Billing', 'Patients', 'Inventory', 'Requests']
  };
}

function buildSystemPrompt({ role, pathname, preferredLanguage }) {
  const scope = role === 'public'
    ? 'You are the public-facing Pascualinga Assistant for Pascual General Hospital. Answer only public hospital questions.'
    : `You are Pascualinga Assistant for an authenticated ${roleLabel(role)} account. Answer only role-appropriate Pascual General Hospital system guidance and public hospital information.`;

  return [
    scope,
    `Current role: ${role}`,
    `Current page: ${String(pathname || '/').trim() || '/'}`,
    'Never answer unrelated general knowledge questions.',
    'Never provide diagnosis, treatment plans, medication recommendations, or prescription advice.',
    'Never invent workflows or features that are not grounded in the provided context.',
    'If the question is outside scope or the answer is uncertain, say so clearly and redirect politely.',
    'Keep answers concise, professional, and helpful.',
    preferredLanguage === 'tagalog'
      ? 'CRITICAL: The user is writing in Tagalog or Taglish. You MUST reply ONLY in Tagalog or natural Taglish. Do NOT use English unless for specific technical labels.'
      : 'CRITICAL: The user is writing in English. You MUST reply ONLY in English. Do NOT use Tagalog.',
    'Use only the grounded context below.',
    gatherContext(role, pathname)
  ].join('\n\n');
}

function buildMiniSummary(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length <= 6) return '';

  // Summarize older context (exclude last 2 messages so the latest question stays prominent).
  const slice = list.slice(0, Math.max(0, list.length - 2));
  const userSnippets = slice
    .filter((m) => String(m?.role || '').toLowerCase() === 'user')
    .map((m) => String(m?.content || '').trim())
    .filter(Boolean)
    .slice(-4);

  const assistantSnippets = slice
    .filter((m) => String(m?.role || '').toLowerCase() === 'assistant')
    .map((m) => String(m?.content || '').trim())
    .filter(Boolean)
    .slice(-2);

  const parts = [];
  if (userSnippets.length) parts.push(`Recent user context: ${userSnippets.join(' | ')}`);
  if (assistantSnippets.length) parts.push(`Recent assistant context: ${assistantSnippets.join(' | ')}`);
  return parts.join('\n');
}

async function createOpenAIResponse({ role, pathname, messages, preferredLanguage }) {
  const inputMessages = [];
  inputMessages.push({
    role: 'system',
    content: [{ type: 'input_text', text: buildSystemPrompt({ role, pathname, preferredLanguage }) }]
  });

  const miniSummary = buildMiniSummary(messages);
  if (miniSummary) {
    inputMessages.push({
      role: 'system',
      content: [{ type: 'input_text', text: `Conversation summary (for context only):\n${miniSummary}` }]
    });
  }

  messages.forEach((msg) => {
    const speaker = msg.role === 'assistant' ? 'assistant' : 'user';
    const text = String(msg.content || '').trim();
    if (!text) return;
    inputMessages.push({
      role: speaker,
      content: [{ type: speaker === 'assistant' ? 'output_text' : 'input_text', text }]
    });
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: inputMessages,
      reasoning: { effort: 'low' },
      max_output_tokens: 280,
      store: false
    })
  });

  clearTimeout(timeout);

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message || `OpenAI request failed (${res.status})`;
    throw new Error(message);
  }

  const answer = String(data?.output_text || '').trim();
  if (!answer) throw new Error('Assistant returned an empty response.');
  return answer;
}

router.post('/chat', async (req, res) => {
  try {
    const requestId =
      (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function' ? globalThis.crypto.randomUUID() : null) ||
      require('crypto').randomUUID();

    // Basic per-IP rate limiting (demo-safe; resets per window)
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim() || 'unknown';
    const key = `${ip}`;
    const now = Date.now();
    const state = assistantRateState.get(key) || { count: 0, resetAt: now + ASSISTANT_RATE_LIMIT_WINDOW_MS };
    if (now > state.resetAt) {
      state.count = 0;
      state.resetAt = now + ASSISTANT_RATE_LIMIT_WINDOW_MS;
    }
    state.count += 1;
    assistantRateState.set(key, state);
    if (state.count > ASSISTANT_RATE_LIMIT_MAX) {
      return res.status(429).json({
        requestId,
        message: 'Too many assistant requests. Please wait a moment and try again.'
      });
    }

    const rawRole = req.headers['x-user-role'] || req.body?.role || '';
    const role = normalizeRole(rawRole || 'public');
    const pathname = String(req.body?.pathname || '/').trim() || '/';
    const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-8) : [];
    const latestUserMessage = [...messages].reverse().find((msg) => String(msg?.role || '').toLowerCase() === 'user');
    const latestText = String(latestUserMessage?.content || '').trim();
    const preferredLanguage = detectPreferredLanguage(latestText);
    const startAt = Date.now();

    if (!latestText) {
      return res.status(400).json({ message: 'A user message is required.' });
    }

    if (!OPENAI_API_KEY) {
      const fallback = localAssistantReply({ role, message: latestText, pathname, preferredLanguage });
      return res.json({ requestId, role, pathname, ...fallback, latencyMs: Date.now() - startAt });
    }

    const protectedReply = localAssistantReply({ role, message: latestText, pathname, preferredLanguage });
    if (protectedReply.source === 'policy') {
      return res.json({ requestId, role, pathname, ...protectedReply, latencyMs: Date.now() - startAt });
    }

    try {
      const answer = await createOpenAIResponse({ role, pathname, messages, preferredLanguage });
      return res.json({
        requestId,
        role,
        pathname,
        answer,
        source: 'openai',
        grounded: true,
        suggestions: protectedReply?.suggestions || [],
        latencyMs: Date.now() - startAt
      });
    } catch (openAiError) {
      const fallback = localAssistantReply({ role, message: latestText, pathname, preferredLanguage });
      return res.json({
        requestId,
        role,
        pathname,
        answer: fallback.answer,
        source: 'fallback',
        grounded: true,
        suggestions: fallback.suggestions || [],
        latencyMs: Date.now() - startAt,
        warning: String(openAiError?.message || 'OpenAI unavailable')
      });
    }
  } catch (error) {
    console.error('Assistant chat error:', error.message);
    return res.status(500).json({
      message: 'Unable to generate assistant response right now.'
    });
  }
});

module.exports = router;
