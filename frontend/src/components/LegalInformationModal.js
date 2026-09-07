import React, { useEffect, useRef } from 'react';
import { FileText, HeartHandshake, X } from 'lucide-react';
import './PrivacyConsentModal.css';

const LEGAL_CONTENT = {
  terms: {
    title: 'Terms of Service',
    subtitle: 'Important conditions for using the Pascualinga public website.',
    icon: FileText,
    sections: [
      { title: '1. Purpose of this website', paragraphs: ['Pascualinga provides general hospital information, service details, contact information, and access to authorized digital services. Website content is for information and service coordination only.'] },
      { title: '2. Not a substitute for medical care', paragraphs: ['Website content and assistant responses do not replace professional medical advice, diagnosis, treatment, or emergency care. For urgent or life-threatening concerns, contact emergency services or proceed to the nearest emergency department.'] },
      { title: '3. Accurate and responsible use', paragraphs: ['Users must provide accurate information, protect their account credentials, and use the system only for lawful purposes. Do not attempt to access another person’s records, disrupt the service, or upload harmful or misleading content.'] },
      { title: '4. Availability and external links', paragraphs: ['Services may occasionally be unavailable for maintenance or technical reasons. Links to official third-party websites are provided for convenience; their content and availability are managed by their respective organizations.'] },
      { title: '5. Privacy and records', paragraphs: ['Personal and health information is handled according to the Pascualinga Data Privacy Statement and applicable Philippine privacy requirements. Authorized clinical records may also be retained when required for care, hospital operations, or legal compliance.'] },
      { title: '6. Updates and questions', paragraphs: ['These terms may be updated when the website or hospital services change. Contact Pascual General Hospital directly if you need clarification before using a service.'] }
    ]
  },
  rights: {
    title: 'Patient Rights',
    subtitle: 'A clear summary of the respect and participation every patient should receive.',
    icon: HeartHandshake,
    sections: [
      { title: 'Respectful and appropriate care', bullets: ['Receive considerate, humane, and appropriate care without discrimination, within the hospital’s available resources and professional capabilities.', 'Have personal dignity, culture, beliefs, safety, and reasonable privacy respected during care.'] },
      { title: 'Clear information and participation', bullets: ['Receive understandable information about your condition, proposed care, expected benefits, material risks, alternatives, and likely costs.', 'Know the identity and professional role of the people involved in your care.', 'Participate in decisions and ask questions before giving informed consent, subject to emergency and other lawful exceptions.'] },
      { title: 'Choice, consent, and confidentiality', bullets: ['Accept or refuse proposed care and be informed of the possible consequences, as permitted by law.', 'Request another professional opinion when reasonably available.', 'Expect medical and personal information to remain confidential and disclosed only when authorized or legally required.'] },
      { title: 'Records, communication, and support', bullets: ['Request access to information about your care through the hospital’s authorized process, subject to applicable rules.', 'Communicate with family or representatives and receive visitors within reasonable clinical and hospital restrictions.', 'Receive reasonable assistance in understanding hospital procedures and responsibilities.'] },
      { title: 'Questions and grievances', bullets: ['Raise questions, concerns, or complaints without discrimination or retaliation.', 'Ask hospital personnel where to submit a concern and request information about how it will be reviewed.'] },
      { title: 'Important note', paragraphs: ['This page is a general public summary. Specific rights and procedures may depend on applicable law, professional standards, the patient’s condition, and hospital policy.'] }
    ]
  }
};

export default function LegalInformationModal({ type, onClose }) {
  const closeRef = useRef(null);
  const content = LEGAL_CONTENT[type];

  useEffect(() => {
    if (!content) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [content, onClose]);

  if (!content) return null;
  const Icon = content.icon;

  return (
    <div className="privacy-consent-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="privacy-consent-modal" role="dialog" aria-modal="true" aria-labelledby={`legal-${type}-title`}>
        <header className="privacy-consent-header legal-information-header">
          <div className="privacy-consent-mark"><Icon size={25} /></div>
          <div className="legal-information-heading">
            <span className="privacy-consent-kicker">Pascualinga Medical Link</span>
            <h2 id={`legal-${type}-title`}>{content.title}</h2>
            <p>{content.subtitle}</p>
          </div>
          <button ref={closeRef} type="button" className="legal-information-close" onClick={onClose} aria-label={`Close ${content.title}`}><X size={21} /></button>
        </header>

        <div className="privacy-consent-copy" tabIndex="0">
          {content.sections.map((section) => (
            <article key={section.title}>
              <h3>{section.title}</h3>
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.bullets ? <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul> : null}
            </article>
          ))}
          <p className="legal-information-updated">Last updated: September 7, 2026</p>
        </div>

        <footer className="privacy-consent-actions">
          <button type="button" className="privacy-accept legal-information-done" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}
