import React, { useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import './PrivacyConsentModal.css';

export const PRIVACY_CONSENT_KEY = 'pascualinga_privacy_v1';

export function hasPrivacyConsent() {
  try {
    return window.localStorage.getItem(PRIVACY_CONSENT_KEY) === 'accepted';
  } catch (_) {
    return false;
  }
}

const sections = [
  {
    title: '1. Introduction',
    paragraphs: [
      'The Pascualinga Hospital Management System, operated by Pascualinga Hospital Administration, is committed to protecting the personal and sensitive information of its authorized workforce and respecting your privacy. This Data Privacy Statement explains how we collect, use, process, share, and protect your personal data and administrative activity logs when you access and use the Pascualinga portal, in compliance with the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).',
      'By logging into the Pascualinga portal and accessing its modules, you explicitly consent to the data processing practices described in this statement and agree to uphold all institutional confidentiality obligations regarding patient medical records.'
    ]
  },
  {
    title: '2. What Personal Data We Collect',
    paragraphs: ['We collect personal and professional information that identifies you as an authorized hospital employee, medical practitioner, or administrative staff member. The types of data we may collect include:'],
    items: [
      ['Personal & Professional Identification', 'Full Name, Employee ID Number, Professional Regulation Commission (PRC) License Number (for Doctors and Nurses), Job Role, and Department Assignment.'],
      ['Contact Information', 'Official hospital email address and direct extension/contact details.'],
      ['Account Credentials', 'Encrypted password hashes, authentication tokens, and access privileges associated with your role (Admin, Doctor, Nurse, Pharmacist, Cashier, or Patient Registrar).'],
      ['System Activity & Audit Logs', 'Timestamps, IP addresses, browser types, module access logs, transaction histories, and digital signatures generated whenever you create, edit, update, or view patient health and financial records.']
    ]
  },
  {
    title: '3. How We Collect Your Data',
    paragraphs: ['We collect your personal and activity data primarily when you:'],
    bullets: [
      'Log in and authenticate your identity via the Pascualinga employee portal.',
      'Update your user profile or security credentials.',
      'Encode, update, or retrieve medical charts, prescriptions, laboratory orders, or billing statements.',
      'Process patient admissions, discharges, inventory updates, or payment receipts across system modules.'
    ]
  },
  {
    title: '4. Why We Collect and Process Your Data',
    paragraphs: ['Your personal data and system activity logs are processed strictly for legitimate hospital operational, administrative, and legal compliance purposes, which include:'],
    items: [
      ['Authentication & Access Control', 'To verify your identity and enforce strict Role-Based Access Control (RBAC), ensuring staff only view modules relevant to their duties.'],
      ['Auditability & Patient Safety', 'To maintain an immutable audit trail of all electronic health record (EHR) modifications, safeguarding patient medical integrity and establishing clinical accountability.'],
      ['Operational Efficiency', 'To streamline communication and workflow across clinical, pharmacy, cashiering, and administrative departments.'],
      ['Security & Infrastructure Protection', "To protect the hospital's digital infrastructure against unauthorized access, data leaks, or fraudulent activities."]
    ]
  },
  {
    title: '5. Data Confidentiality & Non-Disclosure',
    paragraphs: [
      'As an authorized user of Pascualinga, you are granting access to Sensitive Personal Information (SPI) comprising patient health, diagnostic, and financial records.',
      'We maintain strict confidentiality regarding employee and patient data. We do not sell, trade, or share your information for commercial or external marketing purposes.',
      'All employee actions within the platform are bound by hospital confidentiality policies, professional medical codes of ethics, and RA 10173. Unauthorized disclosure or copying of patient data is strictly prohibited and subject to administrative and legal penalties.'
    ]
  },
  {
    title: '6. Data Retention and Disposal',
    paragraphs: ['We retain employee profile data and system audit logs only as long as necessary to fulfill operational, legal, and regulatory requirements:'],
    items: [
      ['Active Employee Records', 'Profile data remains active throughout your employment or professional engagement with the hospital.'],
      ['Audit Trail Logs', 'Transaction logs linked to patient health records are retained in compliance with Department of Health (DOH) medical record retention standards.'],
      ['Separated Staff Accounts', 'Upon resignation or termination, employee credentials are immediately deactivated. Profile records are archived or anonymized in accordance with statutory retention limits.']
    ]
  },
  {
    title: '7. Data Security',
    paragraphs: ['Pascualinga employs robust technical, physical, and organizational security measures to prevent data loss, unauthorized access, or tampering:'],
    items: [
      ['Database & Communication Security', 'Encryption protocols for data in transit and at rest via Supabase cloud storage.'],
      ['Access Isolation', 'Strict database row-level security (RLS) ensuring isolated module access per user role.'],
      ['Monitoring', 'Continuous security logging to detect unusual access behavior or privilege escalation attempts.']
    ]
  },
  {
    title: '8. Rights of the Data Subject',
    paragraphs: ['Under the Data Privacy Act of 2012, you possess the following rights regarding your personal data processed within Pascualinga:'],
    items: [
      ['Right to be Informed', 'To know how your employee data and activity logs are being processed.'],
      ['Right to Access', 'To request a copy of your personal profile and system access records held in the database.'],
      ['Right to Rectification', 'To request corrections to inaccurate or outdated personal employee information.'],
      ['Right to File a Complaint', 'To raise privacy concerns with the Hospital Data Protection Officer (DPO) or the National Privacy Commission (NPC) if your data rights are compromised.']
    ]
  }
];

function PrivacyConsentModal({ open, onAccept, onDecline, requireAcknowledgement = true }) {
  const acceptRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    acceptRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  if (!open) return null;

  const accept = () => {
    try { window.localStorage.setItem(PRIVACY_CONSENT_KEY, 'accepted'); } catch (_) {}
    onAccept?.();
  };

  return (
    <div className="privacy-consent-overlay">
      <section className="privacy-consent-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-consent-title">
        <header className="privacy-consent-header">
          <div className="privacy-consent-mark"><ShieldCheck size={25} /></div>
          <div>
            <span className="privacy-consent-kicker">Pascualinga Medical Link</span>
            <h2 id="privacy-consent-title">Data Privacy Statement</h2>
            <p>{requireAcknowledgement ? 'Please read and acknowledge our data privacy statement before proceeding.' : 'Review how Pascualinga handles personal and health information.'}</p>
          </div>
        </header>

        <div className="privacy-consent-copy" tabIndex="0">
          {sections.map((section) => (
            <article key={section.title}>
              <h3>{section.title}</h3>
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {(section.items || section.bullets) ? (
                <ul>
                  {section.items?.map(([label, copy]) => <li key={label}><strong>{label}:</strong> {copy}</li>)}
                  {section.bullets?.map((copy) => <li key={copy}>{copy}</li>)}
                </ul>
              ) : null}
            </article>
          ))}
        </div>

        <footer className="privacy-consent-actions">
          {requireAcknowledgement ? (
            <>
              <button type="button" className="privacy-decline" onClick={onDecline}>Decline</button>
              <button ref={acceptRef} type="button" className="privacy-accept" onClick={accept}>I Agree and Continue</button>
            </>
          ) : (
            <button ref={acceptRef} type="button" className="privacy-accept legal-information-done" onClick={onDecline}>Close</button>
          )}
        </footer>
      </section>
    </div>
  );
}

export default PrivacyConsentModal;
