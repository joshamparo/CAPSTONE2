import React, { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./HomePage.css";
import "../components/AccountHeaderActions.css";
import SignOutConfirmModal from "../components/SignOutConfirmModal";
import { Phone, Bone, Stethoscope, MapPin, Mail, Clock, Facebook, MessageCircle, Scissors, Syringe, Baby, Ear, Microscope, Smile, Eye, Scan, Droplet, Sparkles, ShieldCheck, Users, HeartPulse, Building2, BadgeCheck } from "lucide-react";

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
const HOSPITAL_LOCATION = {
  name: "Pascual General Hospital",
  address: "Pascual General Hospital, Novaliches, Quezon City, Metro Manila",
  latitude: 14.666991,
  longitude: 121.0090838
};
const GOOGLE_MAPS_PLACE_URL = "https://www.google.com/maps/place/Pascual+General+Hospital/@14.6670465,121.0081596,225m/data=!3m1!1e3!4m6!3m5!1s0x3397b695162c8be5:0xc37a34c97bbe0f67!8m2!3d14.666991!4d121.0090838!16s%2Fg%2F1tjgxx8x";
const GOOGLE_MAPS_EMBED_URL = `https://maps.google.com/maps?hl=en&q=${HOSPITAL_LOCATION.latitude},${HOSPITAL_LOCATION.longitude}%20(${encodeURIComponent(HOSPITAL_LOCATION.name)})&z=21&t=k&iwloc=B&output=embed`;

const serviceGroups = [
  {
    key: "clinical",
    label: "Clinical",
    items: [
      { icon: <Stethoscope size={44} />, title: "Medicine", desc: "General medical consultations and management of conditions." },
      { icon: <Baby size={44} />, title: "Pediatrics", desc: "Comprehensive healthcare services for infants and children." },
      { icon: <Baby size={44} />, title: "Obstetrics - Gynecology", desc: "Women’s health services including prenatal and OB care." },
      { icon: <Sparkles size={44} />, title: "Dermatology", desc: "Skin, hair, and nail consultation and treatment services." }
    ]
  },
  {
    key: "surgical",
    label: "Surgical",
    items: [
      { icon: <Scissors size={44} />, title: "Surgery", desc: "Operative procedures with patient safety as priority." },
      { icon: <Bone size={44} />, title: "Orthopedics", desc: "Bone, joint, and musculoskeletal care and treatment." },
      { icon: <Syringe size={44} />, title: "Anesthesia", desc: "Perioperative anesthesia services and pain management." }
    ]
  },
  {
    key: "diagnostic",
    label: "Diagnostic",
    items: [
      { icon: <Scan size={44} />, title: "Radiology", desc: "Diagnostic imaging services to support clinical decisions." },
      { icon: <Microscope size={44} />, title: "Pathology", desc: "Laboratory and diagnostic support for accurate evaluation." }
    ]
  },
  {
    key: "specialty",
    label: "Specialty",
    items: [
      { icon: <Eye size={44} />, title: "Ophthalmology", desc: "Eye consultation, screening, and vision-related care." },
      { icon: <Ear size={44} />, title: "Otolaryngology", desc: "ENT services for ear, nose, throat, and related concerns." },
      { icon: <Droplet size={44} />, title: "Urology", desc: "Urinary tract and male reproductive health services." },
      { icon: <Smile size={44} />, title: "Dental Medicine", desc: "Oral health services including consultation and dental care." }
    ]
  }
];

const allServices = serviceGroups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.key })));

const trustHighlights = [
  {
    title: "Private Community Hospital",
    text: "A warm, professionally managed care environment rooted in the local community."
  },
  {
    title: "24/7 Emergency Readiness",
    text: "Immediate care access stays visible and easy to reach for families who need help fast."
  },
  {
    title: "Complete Hospital Support",
    text: "Clinical, diagnostic, surgical, and specialty services are available in one trusted facility."
  },
  {
    title: "Compassionate Experience",
    text: "Every visit is shaped by attentive service, clear communication, and respectful care."
  }
];

const careEnvironmentCards = [
  {
    image: "/images/174e4c64-a5a6-4867-a25a-d03870ce1a61.jfif",
    title: "Pharmacy Support",
    text: "Accessible medicine support and dependable coordination for daily patient needs."
  },
  {
    image: "/images/b286a6f7-dc1d-4604-a84f-e009dfa50d64.jfif",
    title: "Organized Care Environment",
    text: "A clean and structured hospital interior designed to support safe workflows."
  },
  {
    image: "/images/c26e46b7-fcce-4d8f-be50-bc9bee7f80e0.jfif",
    title: "Convenient Service Points",
    text: "Welcoming service areas that help visitors find assistance and information quickly."
  }
];

const slides = [
  {
    image: "/images/316bd0d0-aac7-488c-a840-6bc126954372.jfif",
    title: "Pascual General Hospital",
    subtitle: "Trusted care, guided by compassion and innovation."
  },
  {
    image: "/images/2940154b-6054-4c47-8db6-b8c822c43c2f.jfif",
    title: "Emergency Services",
    subtitle: "Ready to respond when every second matters."
  },
  {
    image: "/images/174e4c64-a5a6-4867-a25a-d03870ce1a61.jfif",
    title: "Hospital Pharmacy",
    subtitle: "Safe dispensing and reliable support for patient care."
  },
  {
    image: "/images/b286a6f7-dc1d-4604-a84f-e009dfa50d64.jfif",
    title: "Inside the Hospital",
    subtitle: "A safe and organized environment for patients and staff."
  },
  {
    image: "/images/c26e46b7-fcce-4d8f-be50-bc9bee7f80e0.jfif",
    title: "Pharmacy Window",
    subtitle: "Accessible information and efficient service."
  }
];

const NEWS_FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1516574187841-cb9cc2ca948b?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=900&q=80'
];

function pickNewsImage(item, index) {
  const directImage = String(item?.imageUrl || '').trim();
  if (/^https:\/\//i.test(directImage)) return directImage;

  const basis = String(item?.url || item?.title || index);
  const hash = Array.from(basis).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return NEWS_FALLBACK_IMAGES[hash % NEWS_FALLBACK_IMAGES.length];
}

function HomePage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [user, setUser] = useState(null);
  const [activeServiceGroup, setActiveServiceGroup] = useState('all');
  const [showAllServices, setShowAllServices] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [newsItems, setNewsItems] = useState([
    {
      id: 'news-1',
      category: 'Health & Lifestyle',
      label: 'PhilHealth',
      source: 'PhilHealth',
      title: 'PhilHealth, CHR Unite to Champion Healthcare as a Fundamental Human Right',
      summary: 'PhilHealth and the Commission on Human Rights (CHR) joined forces for a learning forum titled "Health as a Human Right: Bridging the Healthcare Divide" to reinforce access to quality healthcare as a fundamental human right.',
      url: 'https://www.philhealth.gov.ph/news/up/article/2026/news_6a3b405bdfbb6.php',
      imageUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=900&q=80'
    },
    {
      id: 'news-2',
      category: 'Health & Lifestyle',
      label: 'PhilHealth',
      source: 'PhilHealth',
      title: 'PhilHealth Launches GAMOT in Zamboanga Sibugay, Offering ₱20,000 in Annual Free Medicines',
      summary: 'PhilHealth officially launched the Guaranteed and Accessible Medications for Outpatient Treatment (GAMOT) program, establishing a provincial system where eligible members can access up to ₱20,000 worth of free essential medicines annually.',
      url: 'https://www.philhealth.gov.ph/news/up/article/2026/news_6a2634094e2bd.php',
      imageUrl: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=900&q=80'
    },
    {
      id: 'news-3',
      category: 'Philippine News',
      label: 'DOH Philippines',
      source: 'Inquirer.net',
      title: 'Health workers to new DOH chief: Tackle unresolved healthcare woes',
      summary: 'Health care workers in both public and private sectors welcomed the appointment of Dr. Brix Pujalte Jr. as the new DOH secretary, calling for him to address unresolved problems and improve public healthcare.',
      url: 'https://newsinfo.inquirer.net/2263694/health-workers-to-new-doh-chief-tackle-unresolved-healthcare-woes',
      imageUrl: 'https://images.unsplash.com/photo-1530497610245-94d3c16cda28?auto=format&fit=crop&w=900&q=80'
    }
  ]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [newsCursor, setNewsCursor] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    // Check for logged in user
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      // Construct a user object that the component expects, ensuring name and role are present
      const name = parsedUser.first_name ? `${parsedUser.first_name}` : (parsedUser.name || 'Staff');
      setUser({
        ...parsedUser,
        name: name,
        accountType: parsedUser.account_type || parsedUser.accountType,
      });
    }

    const slideInterval = setInterval(() => {
      setCurrentSlide((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
    }, 5000);
    return () => clearInterval(slideInterval);
  }, []);

  useEffect(() => {
    // We use hardcoded high-quality static news for better UI consistency
    setNewsLoading(false);
  }, []);

  useEffect(() => {
    if (newsLoading) return;
    const len = Array.isArray(newsItems) ? newsItems.length : 0;
    if (len <= 3) return;
    const t = setInterval(() => {
      setNewsCursor((prev) => (prev + 1) % len);
    }, 8000);
    return () => clearInterval(t);
  }, [newsItems, newsLoading]);

  useEffect(() => {
        if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return undefined;

        const elements = Array.from(document.querySelectorAll('.reveal-on-scroll, .reveal-on-zoom'));
        if (!elements.length) return undefined;

        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              entry.target.classList.add('is-visible');
              observer.unobserve(entry.target);
            });
          },
          { threshold: 0.08, rootMargin: '0px 0px -16px 0px' }
        );

        elements.forEach((element) => observer.observe(element));
        return () => observer.disconnect();
      }, []);

  const visibleNews = useMemo(() => {
    if (newsLoading) return [{}, {}, {}];
    const list = Array.isArray(newsItems) ? newsItems.filter((item) => String(item?.url || '').trim()) : [];
    const len = list.length;
    if (!len) return [];
    if (len <= 3) return list.slice(0, 3);
    const start = ((Number(newsCursor) || 0) % len + len) % len;
    const out = [];
    for (let i = 0; i < 3; i += 1) {
      out.push(list[(start + i) % len]);
    }
    return out;
  }, [newsCursor, newsItems, newsLoading]);

  const handleLogout = async () => {
    const storedUser = JSON.parse(localStorage.getItem('currentUser'));
    if (storedUser && storedUser._id) {
        try {
            const role = String(storedUser.account_type || storedUser.accountType || storedUser.role || '').toLowerCase();
            const email = String(storedUser.email || '').trim();
            await fetch(`${API_BASE}/api/staff/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-user-role': role, ...(email ? { 'x-user-email': email } : {}) },
                body: JSON.stringify({ 
                    id: storedUser._id, 
                    accountType: storedUser.account_type || storedUser.accountType
                })
            });
        } catch (error) {
            console.error("Failed to notify backend of logout:", error);
        }
    }
    localStorage.removeItem('currentUser');
    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    setUser(null);
    navigate('/');
  };

  const handleGoToDashboard = () => {
    if (user && user.accountType) {
      const role = user.accountType.toLowerCase();
      navigate(`/${role}`);
    }
  };

  return (
    <div className="homepage">
      <style>{`
        .page-section {
          position: relative;
          overflow: hidden;
        }
        .page-shell {
          max-width: 1200px;
          margin: 0 auto;
          width: 100%;
        }
        .reveal-on-scroll {
          opacity: 0;
          transform: translateY(48px);
          transition: opacity 1s cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          will-change: opacity, transform;
        }
        .reveal-on-scroll.is-visible {
          opacity: 1;
          transform: translateY(0);
        }
        .reveal-on-zoom {
          opacity: 0;
          transform: translateY(48px) scale(0.95);
          transition: opacity 1s cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          will-change: opacity, transform;
        }
        .reveal-on-zoom.is-visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        .reveal-delay-1 { transition-delay: 0.08s; }
        .reveal-delay-2 { transition-delay: 0.16s; }
        .reveal-delay-3 { transition-delay: 0.24s; }
        .reveal-delay-4 { transition-delay: 0.32s; }
        .reveal-delay-5 { transition-delay: 0.4s; }
        .reveal-delay-6 { transition-delay: 0.48s; }
        .eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 0.55rem;
          padding: 0.55rem 1rem;
          border-radius: 999px;
          background: rgba(255, 237, 213, 0.92);
          color: #c2410c;
          font-size: 0.9rem;
          font-weight: 800;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .main-nav {
          display: flex;
          align-items: center;
          gap: 2rem;
        }
        .main-nav a {
          font-weight: 500;
          color: #334155;
          text-decoration: none;
          transition: color 0.2s;
        }
        .main-nav a:hover {
          color: #ea580c;
        }
        .user-greeting-wrapper {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .nav-btn-primary {
          padding: 10px 24px;
          background: #ea580c;
          color: white !important;
          border-radius: 24px;
          text-decoration: none;
          font-weight: 600;
          transition: all 0.2s;
          border: none;
          cursor: pointer;
          font-size: 0.95rem;
          box-shadow: 0 2px 4px rgba(234, 88, 12, 0.2);
          display: inline-block;
        }
        .nav-btn-primary:hover {
          background: #c2410c;
          transform: translateY(-1px);
          box-shadow: 0 4px 6px rgba(234, 88, 12, 0.3);
        }
        .nav-btn-danger {
          padding: 10px 24px;
          background: transparent;
          color: #ef4444;
          border: 2px solid #ef4444;
          border-radius: 24px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.95rem;
        }
        .nav-btn-danger:hover {
          background: #ef4444;
          color: white;
          transform: translateY(-1px);
          box-shadow: 0 4px 6px rgba(239, 68, 68, 0.2);
        }
        .hero-content {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          width: 90%;
          max-width: 900px;
          z-index: 10;
          background: radial-gradient(circle, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 70%);
          padding: 40px;
          border-radius: 20px;
        }
        .hero-shell {
          position: absolute;
          inset: 0;
          z-index: 12;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2.5rem 2rem;
          pointer-events: none;
        }
        .hero-layout {
          max-width: 1200px;
          width: 100%;
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.7fr);
          gap: 2.75rem;
          align-items: center;
        }
        .hero-panel,
        .hero-info-card {
          pointer-events: auto;
        }
        .hero-panel {
          max-width: 620px;
          padding: 1rem 0;
          border-radius: 0;
          background: none;
          border: 0;
          backdrop-filter: none;
          box-shadow: none;
        }
        .hero-panel .hero-title {
          margin-bottom: 1rem;
        }
        .hero-panel .hero-subtitle {
          max-width: 540px;
          margin-bottom: 0;
        }
        .hero-info-card {
          background: rgba(255, 255, 255, 0.88);
          color: #0f172a;
          padding: 1.1rem;
          border-radius: 22px;
          border: 1px solid rgba(255,255,255,0.65);
          box-shadow: 0 18px 32px rgba(15, 23, 42, 0.14);
          backdrop-filter: blur(8px);
          max-width: 390px;
          justify-self: end;
        }
        .hero-info-title {
          font-size: 1.05rem;
          font-weight: 800;
          margin-bottom: 0.3rem;
        }
        .hero-info-subtitle {
          color: #64748b;
          line-height: 1.6;
          margin-bottom: 0.85rem;
          font-size: 0.95rem;
        }
        .hero-info-list {
          display: grid;
          gap: 0.7rem;
          margin-bottom: 1rem;
        }
        .hero-info-item {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 0.78rem 0.9rem;
          border-radius: 16px;
          background: rgba(255, 247, 237, 0.92);
          border: 1px solid rgba(251, 146, 60, 0.45);
        }
        .hero-info-item strong {
          display: block;
          font-size: 0.92rem;
          margin-bottom: 0.15rem;
        }
        .hero-info-item span {
          color: #475569;
          font-size: 0.9rem;
          line-height: 1.5;
        }
        .hero-info-call {
          display: inline-flex;
          align-items: center;
          gap: 0.6rem;
          color: #ea580c;
          font-weight: 800;
          text-decoration: none;
          font-size: 0.98rem;
        }
        .hero-title {
          font-size: 4rem;
          font-weight: 800;
          color: white;
          text-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);
          margin-bottom: 1.2rem;
          line-height: 1.04;
          letter-spacing: -1px;
        }
        .hero-subtitle {
          font-size: 1.22rem;
          color: rgba(248, 250, 252, 0.96);
          text-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
          font-weight: 500;
          line-height: 1.6;
        }
        .hero-buttons-wrapper {
          display: flex;
          gap: 1rem;
          justify-content: flex-start;
          margin-top: 2rem;
          flex-wrap: wrap;
        }
        .hero-btn-outline {
          padding: 13px 30px;
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
          border: 1px solid rgba(255,255,255,0.78);
          border-radius: 50px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          backdrop-filter: blur(4px);
        }
        .hero-btn-outline:hover {
          background: #ffffff;
          color: #0f172a;
          transform: translateY(-3px);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
        }
        .hero-btn-filled {
          padding: 13px 30px;
          background: #ea580c;
          color: #ffffff;
          border: 2px solid #ea580c;
          border-radius: 50px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 14px 0 rgba(234, 88, 12, 0.39);
        }
        .hero-btn-filled:hover {
          background: #c2410c;
          border-color: #c2410c;
          transform: translateY(-3px);
          box-shadow: 0 8px 25px rgba(234, 88, 12, 0.5);
        }
        .hero-quick-strip {
          background: linear-gradient(180deg, #fff7ed 0%, #ffffff 100%);
          padding: 1.35rem 2rem;
          border-top: 1px solid rgba(251, 146, 60, 0.18);
          border-bottom: 1px solid rgba(251, 191, 36, 0.16);
        }
        .hero-quick-grid {
          max-width: 1200px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1rem;
        }
        .hero-quick-card {
          background: rgba(255,255,255,0.88);
          border: 1px solid #fed7aa;
          border-radius: 20px;
          padding: 1.15rem 1.2rem;
          display: flex;
          gap: 0.95rem;
          align-items: flex-start;
          box-shadow: 0 10px 25px rgba(234, 88, 12, 0.08);
        }
        .hero-quick-icon {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          background: linear-gradient(135deg, #ea580c, #f59e0b);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .hero-quick-card strong {
          display: block;
          color: #0f172a;
          margin-bottom: 0.22rem;
          font-size: 0.98rem;
        }
        .hero-quick-card span {
          color: #64748b;
          line-height: 1.55;
          font-size: 0.94rem;
        }
        .identity-section {
          padding: 5rem 2rem;
          background:
            radial-gradient(circle at top left, rgba(251, 191, 36, 0.12), transparent 32%),
            linear-gradient(180deg, #ffffff 0%, #fffaf5 100%);
        }
        .identity-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(320px, 460px);
          gap: 2.5rem;
          align-items: center;
        }
        .identity-copy {
          display: grid;
          gap: 1.15rem;
        }
        .identity-copy .section-title {
          text-align: left;
          margin-bottom: 0;
        }
        .identity-copy p {
          color: #475569;
          line-height: 1.85;
          font-size: 1.05rem;
          margin: 0;
        }
        .identity-notes {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1rem;
          margin-top: 0.6rem;
        }
        .identity-note {
          background: #ffffff;
          border: 1px solid #fde68a;
          border-radius: 20px;
          padding: 1.25rem;
          box-shadow: 0 16px 28px rgba(245, 158, 11, 0.08);
        }
        .identity-note strong {
          display: block;
          color: #0f172a;
          margin-bottom: 0.4rem;
        }
        .identity-note span {
          color: #64748b;
          line-height: 1.6;
          font-size: 0.95rem;
        }
        .identity-visual {
          position: relative;
          border-radius: 30px;
          overflow: hidden;
          min-height: 460px;
          box-shadow: 0 28px 50px rgba(15, 23, 42, 0.16);
        }
        .identity-visual img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .identity-badge {
          position: absolute;
          right: 20px;
          bottom: 20px;
          background: rgba(255,255,255,0.95);
          border-radius: 22px;
          padding: 1rem 1.15rem;
          box-shadow: 0 18px 30px rgba(15, 23, 42, 0.18);
          max-width: 280px;
        }
        .identity-badge strong {
          display: block;
          color: #0f172a;
          margin-bottom: 0.3rem;
        }
        .identity-badge span {
          color: #64748b;
          line-height: 1.55;
          font-size: 0.94rem;
        }
        .care-section {
          padding: 5rem 2rem;
          background: #ffffff;
        }
        .care-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1.5rem;
          margin-top: 2.5rem;
        }
        .care-card {
          background: #fffaf0;
          border: 1px solid #fed7aa;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 18px 30px rgba(245, 158, 11, 0.08);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .care-card:hover {
          transform: translateY(-6px);
          box-shadow: 0 22px 38px rgba(15, 23, 42, 0.14);
        }
        .care-card-image {
          height: 220px;
          overflow: hidden;
        }
        .care-card-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transition: transform 0.5s ease;
        }
        .care-card:hover .care-card-image img {
          transform: scale(1.05);
        }
        .care-card-body {
          padding: 1.4rem;
        }
        .care-card-body h3 {
          color: #0f172a;
          font-size: 1.2rem;
          margin: 0 0 0.65rem 0;
        }
        .care-card-body p {
          color: #64748b;
          line-height: 1.65;
          margin: 0;
        }
        .news-section {
          position: relative;
        }
        .footer-title {
          color: #ffffff;
          margin-bottom: 1.5rem;
          font-size: 1.25rem;
        }
        .footer-link {
          color: #94a3b8;
          text-decoration: none;
          font-size: 1.02rem;
          transition: color 0.2s ease;
        }
        .footer-link:hover {
          color: #f8fafc;
        }
        @media (prefers-reduced-motion: reduce) {
          .reveal-on-scroll,
          .reveal-on-scroll.is-visible {
            opacity: 1;
            transform: none;
            transition: none;
          }
        }
        .services-more-btn {
          padding: 14px 32px;
          background: white;
          color: #334155;
          border: 2px solid #cbd5e1;
          border-radius: 30px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }
        .services-more-btn:hover {
          background: #f8fafc;
          border-color: #94a3b8;
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .emergency-banner-improved {
          background: linear-gradient(135deg, #ea580c 0%, #f59e0b 100%);
          color: white;
          padding: 4rem 2rem;
          display: flex;
          justify-content: center;
          align-items: center;
          box-shadow: inset 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .emergency-content-improved {
          max-width: 1200px;
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 2rem;
        }
        
        /* --- Section Defaults --- */
        .section-title {
          font-size: 2.5rem;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 1rem;
        }
        .section-subtitle {
          font-size: 1.1rem;
          color: #64748b;
        }

        /* --- Our Services --- */
        .services-section {
          padding: 5rem 2rem;
          background: #f8fafc;
          text-align: center;
        }
        .services-tabs {
          display: flex;
          justify-content: center;
          gap: 1rem;
          margin-bottom: 3rem;
          flex-wrap: wrap;
        }
        .services-tab {
          padding: 10px 24px;
          border-radius: 30px;
          border: 2px solid #cbd5e1;
          background: white;
          color: #64748b;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          font-size: 1rem;
        }
        .services-tab:hover {
          border-color: #ea580c;
          color: #ea580c;
        }
        .services-tab.active {
          background: #ea580c;
          border-color: #ea580c;
          color: white;
          box-shadow: 0 4px 10px rgba(234, 88, 12, 0.3);
        }
        .services-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 2rem;
          max-width: 1200px;
          margin: 0 auto 3rem auto;
        }
        .service-card {
          background: white;
          padding: 2.5rem 2rem;
          border-radius: 20px;
          box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05);
          transition: transform 0.3s, box-shadow 0.3s, border-color 0.3s;
          text-align: left;
          border: 1px solid #f1f5f9;
        }
        .service-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
          border-color: #ea580c;
        }
        .service-icon {
          color: #ea580c;
          margin-bottom: 1.5rem;
        }
        .service-card h4 {
          font-size: 1.25rem;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 1rem;
        }
        .service-card p {
          color: #64748b;
          line-height: 1.6;
        }

        /* --- Why Choose Us --- */
        .trust-section {
          padding: 5rem 2rem;
          background: white;
        }
        .trust-inner {
          max-width: 1200px;
          margin: 0 auto;
          text-align: center;
        }
        .trust-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 2rem;
          margin-top: 3rem;
        }
        .trust-card {
          padding: 2.5rem 2rem;
          border-radius: 20px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          transition: all 0.3s;
        }
        .trust-card:hover {
          background: white;
          box-shadow: 0 15px 30px -5px rgba(0,0,0,0.1);
          transform: translateY(-5px);
          border-color: #ea580c;
        }
        .trust-icon {
          background: #ffedd5;
          width: 70px;
          height: 70px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ea580c;
          margin: 0 auto 1.5rem auto;
        }
        .trust-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 1rem;
        }
        .trust-text {
          color: #64748b;
          line-height: 1.6;
        }

        /* --- Mission, Vision & Core Values --- */
        .mvv-section {
          padding: 5rem 2rem;
          background: #0f172a;
          color: white;
        }
        .mvv-inner {
          max-width: 1200px;
          margin: 0 auto;
          text-align: center;
        }
        .mvv-head .section-title {
          color: white;
        }
        .mvv-head .section-subtitle {
          color: #94a3b8;
        }
        .mvv-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 2rem;
          margin-top: 3rem;
        }
        .mvv-card {
          background: #1e293b;
          padding: 2.5rem;
          border-radius: 20px;
          text-align: left;
          border: 1px solid #334155;
          transition: transform 0.3s, border-color 0.3s;
        }
        .mvv-card:hover {
          transform: translateY(-5px);
          border-color: #ea580c;
        }
        .mvv-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(234, 88, 12, 0.15);
          color: #ea580c;
          padding: 8px 16px;
          border-radius: 30px;
          font-weight: 700;
          margin-bottom: 1.5rem;
          font-size: 0.95rem;
        }
        .mvv-text {
          font-size: 1.1rem;
          line-height: 1.7;
          color: #e2e8f0;
        }
        .mvv-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
        }
        .mvv-pill {
          background: rgba(255,255,255,0.05);
          padding: 10px 18px;
          border-radius: 12px;
          font-weight: 600;
          color: #f8fafc;
          border: 1px solid rgba(255,255,255,0.1);
        }

        /* --- Contact Us --- */
        .contact-section {
          padding: 5rem 2rem;
          background: #f8fafc;
        }
        .contact-inner {
          max-width: 1200px;
          margin: 0 auto;
        }
        .contact-head {
          text-align: center;
          margin-bottom: 3rem;
        }
        .contact-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 3rem;
          align-items: stretch;
        }
        .contact-cards {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .contact-card {
          display: flex;
          gap: 1.5rem;
          background: white;
          padding: 2rem;
          border-radius: 20px;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
          border: 1px solid #e2e8f0;
          transition: all 0.3s;
        }
        .contact-card:hover {
          border-color: #ea580c;
          box-shadow: 0 10px 20px -5px rgba(0,0,0,0.1);
          transform: translateX(5px);
        }
        .contact-icon {
          background: #ffedd5;
          color: #ea580c;
          width: 60px;
          height: 60px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .contact-body {
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .contact-title {
          font-weight: 700;
          font-size: 1.2rem;
          color: #0f172a;
          margin-bottom: 0.5rem;
        }
        .contact-text {
          color: #64748b;
          line-height: 1.5;
          margin-bottom: 0.75rem;
          font-size: 1.05rem;
        }
        .contact-link {
          color: #ea580c;
          font-weight: 600;
          text-decoration: none;
          transition: color 0.2s;
          display: inline-flex;
          align-items: center;
        }
        .contact-link:hover {
          color: #c2410c;
          text-decoration: underline;
        }
        .contact-map {
          position: relative;
          height: 100%;
          min-height: 500px;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
          border: 8px solid white;
        }
        .contact-map-badge {
          position: absolute;
          top: 16px;
          left: 16px;
          z-index: 2;
          max-width: calc(100% - 32px);
          background: rgba(255, 255, 255, 0.96);
          color: #0f172a;
          padding: 12px 14px;
          border-radius: 16px;
          box-shadow: 0 12px 24px rgba(15, 23, 42, 0.16);
          border: 1px solid rgba(226, 232, 240, 0.95);
          backdrop-filter: blur(10px);
        }
        .contact-map-badge-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.98rem;
          font-weight: 800;
          margin-bottom: 4px;
        }
        .contact-map-badge-text {
          color: #475569;
          font-size: 0.92rem;
          line-height: 1.45;
        }

        @media (max-width: 992px) {
          .hero-layout,
          .identity-grid,
          .contact-grid {
            grid-template-columns: 1fr;
          }
          .hero-shell {
            padding: 1.5rem;
          }
          .hero-quick-grid,
          .care-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .contact-grid {
            gap: 2rem;
          }
          .contact-map {
            min-height: 400px;
          }
        }

        @media (max-width: 768px) {
          .header-container {
            flex-direction: column;
            gap: 14px;
            padding: 12px 16px;
          }
          .logo-section {
            gap: 12px;
          }
          .logo-img {
            height: 44px;
          }
          .logo-text h1 {
            font-size: 22px;
          }
          .logo-text span {
            text-align: center;
            text-align-last: auto;
          }
          .main-nav {
            flex-direction: column;
            width: 100%;
            gap: 12px;
          }
          .main-nav a {
            width: 100%;
            text-align: center;
            padding: 12px;
            border-radius: 14px;
            background: rgba(248, 250, 252, 0.9);
            border: 1px solid rgba(226, 232, 240, 0.9);
          }
          .user-greeting-wrapper {
            flex-direction: column;
            align-items: stretch;
            width: 100%;
            gap: 10px;
          }
          .nav-user-greeting {
            margin-right: 0 !important;
            text-align: center;
          }
          .nav-btn-primary,
          .nav-btn-danger {
            width: 100%;
          }

          .hero {
            height: 680px;
          }
          .hero-shell {
            padding: 1rem;
            align-items: center;
          }
          .hero-layout {
            gap: 1rem;
          }
          .hero-panel {
            padding: 0;
            border-radius: 0;
          }
          .hero-content {
            width: 100%;
            max-width: none;
            padding: 0;
            border-radius: 0;
            background: none;
          }
          .hero-title {
            font-size: 2.2rem;
            margin-bottom: 0.9rem;
          }
          .hero-subtitle {
            font-size: 1.05rem;
          }
          .hero-info-card {
            padding: 1.15rem;
            border-radius: 20px;
            max-width: none;
            justify-self: stretch;
          }
          .hero-buttons-wrapper {
            width: 100%;
            gap: 12px;
            margin-top: 1.5rem;
          }
          .hero-btn-outline,
          .hero-btn-filled {
            width: 100%;
            padding: 12px 18px;
            font-size: 1rem;
          }

          .services-section,
          .trust-section,
          .identity-section,
          .care-section,
          .mvv-section,
          .news-section,
          .contact-section {
            padding: 3.5rem 1.25rem;
          }

          .section-title {
            font-size: 1.9rem;
          }
          .section-subtitle {
            font-size: 1rem;
          }

          .services-tabs {
            width: 100%;
            gap: 10px;
          }
          .services-tab {
            width: 100%;
          }
          .services-grid {
            grid-template-columns: 1fr;
            gap: 1.25rem;
          }
          .hero-quick-strip {
            padding: 1rem 1.25rem;
          }
          .hero-quick-grid,
          .identity-notes,
          .care-grid {
            grid-template-columns: 1fr;
          }
          .hero-quick-card,
          .identity-note {
            padding: 1rem;
          }
          .identity-visual {
            min-height: 360px;
          }
          .identity-badge {
            right: 14px;
            bottom: 14px;
            left: 14px;
            max-width: none;
          }

          .service-card,
          .trust-card,
          .care-card,
          .mvv-card,
          .news-card {
            padding: 1.75rem 1.25rem;
          }

          .contact-map {
            min-height: 0;
            height: auto;
            aspect-ratio: 16 / 10;
            border-width: 4px;
          }
          .contact-map-badge {
            top: 12px;
            left: 12px;
            max-width: calc(100% - 24px);
            padding: 10px 12px;
            border-radius: 14px;
          }
          .contact-map-badge-title {
            font-size: 0.92rem;
          }
          .contact-map-badge-text {
            font-size: 0.86rem;
          }

          .contact-grid {
            gap: 1.25rem;
          }

          .contact-card {
            padding: 1.25rem;
            gap: 1rem;
            border-radius: 18px;
            width: 100%;
            max-width: 100%;
          }

          .contact-text,
          .contact-link {
            word-break: break-word;
          }

          .contact-map iframe {
            display: block;
            width: 100%;
            height: 100%;
            border: 0;
          }
        }

        @media (max-width: 380px) {
          .hero {
            height: 640px;
          }
          .hero-title {
            font-size: 2rem;
          }
          .hero-subtitle {
            font-size: 0.98rem;
          }
          .section-title {
            font-size: 1.75rem;
          }

          .contact-map {
            aspect-ratio: 16 / 9;
          }
        }
      `}</style>
      <header className="main-header">
        <div className="header-container">
          <div className="logo-section">
            <img src={process.env.PUBLIC_URL + "/images/pgh logo.png"} alt="PGH Logo" className="logo-img" />
            <div className="logo-text">
              <h1>PASCUALINGA</h1>
              <span>Pascual General Hospital</span>
            </div>
          </div>
          <nav className="main-nav">
            <a href="#about">About Us</a>
            <a href="#services">Our Services</a>
            <a href="#facilities">Facilities</a>
            <a href="#news">News</a>
            <a href="#contact">Contact Us</a>
            {user ? (
              <div className="user-greeting-wrapper">
                <span className="nav-user-greeting" style={{ fontWeight: '600', color: '#334155', marginRight: '10px' }}>
                  Hello, {user.name}
                </span>
                <button 
                  onClick={handleGoToDashboard} 
                  className="nav-btn-primary"
                >
                  Dashboard
                </button>
                <button onClick={() => setShowLogoutConfirm(true)} className="nav-btn-danger">
                  Logout
                </button>
              </div>
            ) : (
              <Link to="/login" className="nav-btn-primary">Staff Login</Link>
            )}
          </nav>
        </div>
      </header>

      <SignOutConfirmModal
        open={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          handleLogout();
        }}
      />

      <section className="hero">
        {slides.map((slide, index) => (
          <div
            key={index}
            className={`hero-slide ${index === currentSlide ? "active" : ""}`}
          >
            <img
              src={process.env.PUBLIC_URL + slide.image}
              alt={slide.title}
              className="hero-img"
            />
          </div>
        ))}
        <div className="hero-overlay" />
        <div className="hero-shell">
          <div className="hero-layout page-shell">
            <div className="hero-panel reveal-on-scroll">
              <div className="eyebrow">Private Hospital Care</div>
              <div className="hero-content" style={{ position: 'static', transform: 'none', left: 'auto', top: 'auto', width: '100%', maxWidth: 'none', textAlign: 'left' }}>
                <h1 className="hero-title">Professional, compassionate care for every family we serve.</h1>
                <p className="hero-subtitle">
                  Pascual General Hospital combines a warm private-hospital experience with dependable emergency support,
                  organized services, and community-rooted care in Novaliches, Quezon City.
                </p>
                <div className="hero-buttons-wrapper">
                  <button
                    className="hero-btn-filled"
                    onClick={() => document.getElementById("services")?.scrollIntoView({ behavior: "smooth" })}
                  >
                    Explore Services
                  </button>
                  <button
                    className="hero-btn-outline"
                    onClick={() => document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" })}
                  >
                    Find Us
                  </button>
                </div>
              </div>
            </div>
            <div className="hero-info-card reveal-on-scroll reveal-delay-2">
              <div className="hero-info-title">Visit with confidence</div>
              <div className="hero-info-subtitle">
                Helpful public information stays visible so visitors can act quickly and navigate the hospital with ease.
              </div>
              <div className="hero-info-list">
                <div className="hero-info-item">
                  <Phone size={20} color="#ea580c" />
                  <div>
                    <strong>24/7 Emergency Line</strong>
                    <span>Immediate contact for urgent concerns and emergency coordination.</span>
                  </div>
                </div>
                <div className="hero-info-item">
                  <MapPin size={20} color="#ea580c" />
                  <div>
                    <strong>Novaliches, Quezon City</strong>
                    <span>{HOSPITAL_LOCATION.address}</span>
                  </div>
                </div>
                <div className="hero-info-item">
                  <Clock size={20} color="#ea580c" />
                  <div>
                    <strong>Public-facing information</strong>
                    <span>Services, hospital updates, location guidance, and contact channels in one place.</span>
                  </div>
                </div>
              </div>
              <a className="hero-info-call" href="tel:09153127144">
                <Phone size={18} />
                Call 0915 312 7144
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="hero-quick-strip page-section">
        <div className="hero-quick-grid">
          <div className="hero-quick-card reveal-on-scroll">
            <div className="hero-quick-icon"><ShieldCheck size={22} /></div>
            <div>
              <strong>Trusted Private Care</strong>
              <span>Warm, community-based hospital service delivered with professional standards.</span>
            </div>
          </div>
          <div className="hero-quick-card reveal-on-scroll reveal-delay-1">
            <div className="hero-quick-icon"><HeartPulse size={22} /></div>
            <div>
              <strong>Emergency Ready</strong>
              <span>Visible emergency access and clear contact points for urgent needs.</span>
            </div>
          </div>
          <div className="hero-quick-card reveal-on-scroll reveal-delay-2">
            <div className="hero-quick-icon"><Building2 size={22} /></div>
            <div>
              <strong>Complete Services</strong>
              <span>Clinical, diagnostic, surgical, and specialty support in one facility.</span>
            </div>
          </div>
          <div className="hero-quick-card reveal-on-scroll reveal-delay-3">
            <div className="hero-quick-icon"><MapPin size={22} /></div>
            <div>
              <strong>Easy to Reach</strong>
              <span>Clear location, contact, and visit information for patients and families.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="services-section page-section" id="services">
        <div className="mb-10 reveal-on-scroll">
          <h2 className="section-title">Our Services</h2>
          <p className="section-subtitle">Explore key hospital services through a clear, patient-friendly service overview.</p>
        </div>
        <div className="services-tabs reveal-on-scroll reveal-delay-1">
          <button
            type="button"
            className={`services-tab ${activeServiceGroup === 'all' ? 'active' : ''}`}
            onClick={() => setActiveServiceGroup('all')}
          >
            All
          </button>
          {serviceGroups.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`services-tab ${activeServiceGroup === g.key ? 'active' : ''}`}
              onClick={() => setActiveServiceGroup(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="services-grid">
          {(activeServiceGroup === 'all' ? allServices : allServices.filter((s) => s.group === activeServiceGroup))
            .slice(0, showAllServices ? undefined : 9)
            .map((service, index) => (
              <div key={`${service.group}-${index}`} className={`service-card reveal-on-scroll reveal-delay-${(index % 4) + 1}`}>
                <div className="service-icon">{service.icon}</div>
                <h4>{service.title}</h4>
                <p>{service.desc}</p>
              </div>
            ))}
        </div>
        <div className="services-footer reveal-on-scroll reveal-delay-2">
          <button type="button" className="services-more-btn" onClick={() => setShowAllServices((v) => !v)}>
            {showAllServices ? 'Show Less' : 'View All Services'}
          </button>
        </div>
      </section>

      <section className="trust-section page-section">
        <div className="trust-inner">
          <div className="trust-head reveal-on-scroll">
            <h2 className="section-title">Why Families Choose Us</h2>
            <p className="section-subtitle">A private hospital experience that stays warm, reliable, and easy to understand.</p>
          </div>
          <div className="trust-grid">
            {trustHighlights.map((item, index) => (
              <div key={item.title} className={`trust-card reveal-on-scroll reveal-delay-${(index % 4) + 1}`}>
                <div className="trust-icon">
                  {index === 0 ? <ShieldCheck size={26} /> : index === 1 ? <HeartPulse size={26} /> : index === 2 ? <Building2 size={26} /> : <Users size={26} />}
                </div>
                <div className="trust-title">{item.title}</div>
                <div className="trust-text">{item.text}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="identity-section page-section" id="about">
        <div className="page-shell identity-grid">
          <div className="identity-copy reveal-on-scroll">
            <div className="eyebrow">About Pascualinga</div>
            <h2 className="section-title">A private hospital presence built on trust, care, and community.</h2>
            <p>
              Pascual General Hospital serves as a dependable healthcare partner for families in the community, combining
              compassionate service with the professionalism expected from a private hospital environment.
            </p>
            <p>
              Our goal is to make the public experience feel clear and reassuring from the first visit, whether someone is
              checking services, locating the hospital, seeking urgent support, or learning more about our care values.
            </p>
            <div className="identity-notes">
              <div className="identity-note reveal-on-scroll reveal-delay-1">
                <strong>Community-rooted care</strong>
                <span>We aim to be approachable, respectful, and reliable for local families who need hospital support.</span>
              </div>
              <div className="identity-note reveal-on-scroll reveal-delay-2">
                <strong>Professional environment</strong>
                <span>Organized facilities, visible contact information, and a clean public-facing experience build confidence.</span>
              </div>
            </div>
          </div>
          <div className="identity-visual reveal-on-zoom reveal-delay-2">
            <img
              src={process.env.PUBLIC_URL + "/images/IMG_20260126_112706_079.jpg"}
              alt="About Pascual General Hospital"
            />
            <div className="identity-badge">
              <strong>Warm private-hospital identity</strong>
              <span>Professional healthcare presentation paired with a more personal, community-trusted atmosphere.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="care-section page-section" id="facilities">
        <div className="page-shell">
          <div className="text-center reveal-on-scroll">
            <div className="eyebrow" style={{ marginBottom: '1rem' }}>Hospital Environment</div>
            <h2 className="section-title">A care environment that feels capable, organized, and welcoming.</h2>
            <p className="section-subtitle" style={{ maxWidth: '760px', margin: '0 auto' }}>
              Real hospital visuals help visitors understand the setting before they arrive, reinforcing trust and a sense of readiness.
            </p>
          </div>
          <div className="care-grid">
          {careEnvironmentCards.map((card, index) => (
            <div key={card.title} className={`care-card reveal-on-zoom reveal-delay-${(index % 4) + 1}`}>
                <div className="care-card-image">
                  <img src={process.env.PUBLIC_URL + card.image} alt={card.title} />
                </div>
                <div className="care-card-body">
                  <h3>{card.title}</h3>
                  <p>{card.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mvv-section page-section">
        <div className="mvv-inner">
          <div className="mvv-head reveal-on-scroll">
            <h2 className="section-title">Mission, Vision & Core Values</h2>
            <p className="section-subtitle">What guides Pascual General Hospital every day.</p>
          </div>
          <div className="mvv-grid">
            <div className="mvv-card reveal-on-scroll reveal-delay-1">
              <div className="mvv-top">
                <div className="mvv-badge"><BadgeCheck size={16} /> Vision</div>
              </div>
              <div className="mvv-text">To be the ideal God and patient-centered care provider in the community we serve.</div>
            </div>
            <div className="mvv-card reveal-on-scroll reveal-delay-2">
              <div className="mvv-top">
                <div className="mvv-badge"><BadgeCheck size={16} /> Mission</div>
              </div>
              <div className="mvv-text">We are committed to deliver optimum holistic patient care by providing accessible, compassionate & quality healthcare.</div>
            </div>
            <div className="mvv-card reveal-on-scroll reveal-delay-3">
              <div className="mvv-top">
                <div className="mvv-badge"><BadgeCheck size={16} /> Core Values</div>
              </div>
              <div className="mvv-list">
                <div className="mvv-pill">Moral Integrity</div>
                <div className="mvv-pill">Compassion</div>
                <div className="mvv-pill">Teamwork</div>
                <div className="mvv-pill">Respect</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* News & Updates Section */}
      <section className="news-section page-section" id="news" style={{ padding: '5rem 2rem', backgroundColor: '#ffffff' }}>
        <div className="page-shell">
          <div style={{ textAlign: 'center', marginBottom: '4rem' }} className="reveal-on-scroll">
            <div className="eyebrow" style={{ marginBottom: '1rem' }}>Current Updates</div>
            <h2 className="section-title" style={{ fontSize: '2.5rem', color: '#0f172a' }}>News & Health Updates</h2>
            <p style={{ color: '#64748b', fontSize: '1.1rem', marginTop: '1rem' }}>
              Live news links from legitimate online publishers, with health and public-interest stories prioritized.
            </p>
          </div>
          
          <div className="news-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
            {newsError ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#b91c1c', fontWeight: 700 }}>
                Unable to refresh the live feed right now.
              </div>
            ) : null}

            {!newsLoading && !visibleNews.length ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#475569', lineHeight: '1.7' }}>
                No live news articles are available at the moment. Please check back shortly.
              </div>
            ) : null}

            {visibleNews.map((n, idx) => {
              const cat = String(n?.category || '');
              const label = String(n?.label || 'Philippines');
              const source = String(n?.source || '');
              const title = String(n?.title || '');
              const summary = String(n?.summary || '');
              const url = String(n?.url || '').trim();
              const img = pickNewsImage(n, idx);

              const badgeStyleByCategory = {
                'Philippine News': { bg: '#ffedd5', fg: '#c2410c' },
                'Health & Lifestyle': { bg: '#dcfce7', fg: '#15803d' }
              };
              const badge = badgeStyleByCategory[cat] || badgeStyleByCategory['Philippine News'];

              return (
                <div key={n?.id || idx} className={`news-card reveal-on-scroll reveal-delay-${(idx % 3) + 1}`} style={{ background: '#f8fafc', borderRadius: '16px', overflow: 'hidden', border: '1px solid #e2e8f0', transition: 'all 0.3s ease' }}>
                  <img src={img} alt={`${cat || 'PH'} News`} style={{ width: '100%', height: '200px', objectFit: 'cover' }} />
                  <div style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: '#64748b', fontSize: '0.85rem', fontWeight: '600', flexWrap: 'wrap' }}>
                      <span style={{ background: badge.bg, color: badge.fg, padding: '4px 10px', borderRadius: '50px' }}>{label}</span>
                      <span>{source || cat || 'Philippines'}</span>
                    </div>

                    {newsLoading ? (
                      <>
                        <div style={{ height: 18, width: '90%', background: '#e2e8f0', borderRadius: 8, marginBottom: 10 }} />
                        <div style={{ height: 12, width: '100%', background: '#e2e8f0', borderRadius: 8, marginBottom: 8 }} />
                        <div style={{ height: 12, width: '92%', background: '#e2e8f0', borderRadius: 8, marginBottom: 20 }} />
                        <div style={{ height: 14, width: 90, background: '#fed7aa', borderRadius: 8 }} />
                      </>
                    ) : (
                      <>
                        <h3 style={{ fontSize: '1.25rem', color: '#0f172a', marginBottom: '0.75rem', lineHeight: '1.4' }}>{title}</h3>
                        <p style={{ color: '#475569', fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>{summary}</p>
                        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#ea580c', fontWeight: '600', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          Read More →
                        </a>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Contact Us Section */}
      <section className="contact-section page-section" id="contact">
        <div className="contact-inner">
          <div className="contact-head reveal-on-scroll">
            <div className="eyebrow" style={{ marginBottom: '1rem' }}>Plan Your Visit</div>
            <h2 className="section-title">Contact and location details that are easy to act on.</h2>
            <p className="section-subtitle">We keep our public information clear so visitors can call, message, or find the hospital without confusion.</p>
          </div>
          <div className="contact-grid">
            <div className="contact-cards">
              <div className="contact-card reveal-on-scroll reveal-delay-1">
                <div className="contact-icon"><MapPin size={24} /></div>
                <div className="contact-body">
                  <div className="contact-title">Our Location</div>
                  <div className="contact-text">{HOSPITAL_LOCATION.address}</div>
                  <a className="contact-link" href={GOOGLE_MAPS_PLACE_URL} target="_blank" rel="noopener noreferrer">
                    Open in Google Maps →
                  </a>
                </div>
              </div>

              <div className="contact-card reveal-on-scroll reveal-delay-2">
                <div className="contact-icon"><Phone size={24} /></div>
                <div className="contact-body">
                  <div className="contact-title">Phone Number</div>
                  <div className="contact-text">0915 312 7144</div>
                  <a className="contact-link" href="tel:09153127144">Call now →</a>
                </div>
              </div>

              <div className="contact-card reveal-on-scroll reveal-delay-3">
                <div className="contact-icon"><Mail size={24} /></div>
                <div className="contact-body">
                  <div className="contact-title">Email Address</div>
                  <div className="contact-text">pascualgenhospi@gmail.com</div>
                  <a className="contact-link" href="mailto:pascualgenhospi@gmail.com">Send an email →</a>
                </div>
              </div>

              <div className="contact-card reveal-on-scroll reveal-delay-4">
                <div className="contact-icon"><Clock size={24} /></div>
                <div className="contact-body">
                  <div className="contact-title">Visiting Hours</div>
                  <div className="contact-text">Available 24/7 for Emergencies</div>
                </div>
              </div>
            </div>

            <div className="contact-map reveal-on-scroll reveal-delay-2">
              <div className="contact-map-badge">
                <div className="contact-map-badge-title">
                  <MapPin size={16} />
                  <span>{HOSPITAL_LOCATION.name}</span>
                </div>
                <div className="contact-map-badge-text">{HOSPITAL_LOCATION.address}</div>
              </div>
              <iframe
                title="PGH Location Map"
                src={GOOGLE_MAPS_EMBED_URL}
                width="100%"
                height="100%"
                allowFullScreen=""
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              ></iframe>
            </div>
          </div>
        </div>
      </section>

      {/* Emergency Banner (Moved to bottom) */}
      <section className="emergency-banner-improved page-section">
        <div className="emergency-content-improved reveal-on-scroll">
          <div className="banner-section" style={{ flex: '1 1 500px' }}>
            <h2 style={{ fontSize: '2.5rem', fontWeight: '800', margin: '0 0 10px 0' }}>Need Immediate Care?</h2>
            <p style={{ fontSize: '1.2rem', margin: 0, opacity: '0.9' }}>Our emergency department is staffed 24/7 with specialists ready to handle any critical situation.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', background: 'rgba(255,255,255,0.1)', padding: '20px 40px', borderRadius: '20px', backdropFilter: 'blur(10px)' }}>
            <Phone size={32} fill="white" />
            <div>
              <div style={{ fontSize: '1.1rem', opacity: '0.9', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600' }}>Emergency Dial</div>
              <div style={{ fontSize: '2.5rem', fontWeight: '800', lineHeight: '1' }}>0915 312 7144</div>
            </div>
          </div>
        </div>
      </section>

      {/* Global Footer */}
      <footer className="global-footer page-section" style={{ backgroundColor: '#0f172a', color: '#f8fafc', padding: '4rem 2rem 2rem 2rem' }}>
        <div className="page-shell reveal-on-scroll" style={{ display: 'flex', flexWrap: 'wrap', gap: '3rem', justifyContent: 'space-between' }}>
          
          {/* Brand & Socials */}
          <div style={{ flex: '1 1 300px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
              <img src={process.env.PUBLIC_URL + "/images/pgh logo.png"} alt="PGH Logo" style={{ width: '45px', height: '45px', backgroundColor: 'white', borderRadius: '50%', padding: '4px' }} />
              <h2 style={{ margin: 0, fontSize: '1.75rem', color: '#ffffff', letterSpacing: '1px' }}>PASCUALINGA</h2>
            </div>
            <p style={{ color: '#94a3b8', lineHeight: '1.6', marginBottom: '1.5rem', fontSize: '1rem' }}>
              Trusted care, guided by compassion and innovation. Your health and safety are our top priorities.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <a href="#facebook" style={{ color: '#f8fafc', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '10px 16px', backgroundColor: '#1e293b', borderRadius: '8px', transition: 'background 0.3s' }}>
                <Facebook size={20} color="#3b82f6" /> <span style={{fontSize: '0.95rem', fontWeight: '500'}}>Facebook</span>
              </a>
              <a href="#viber" style={{ color: '#f8fafc', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '10px 16px', backgroundColor: '#1e293b', borderRadius: '8px', transition: 'background 0.3s' }}>
                <MessageCircle size={20} color="#a855f7" /> <span style={{fontSize: '0.95rem', fontWeight: '500'}}>Viber</span>
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div style={{ flex: '1 1 200px' }}>
            <h3 className="footer-title">Quick Links</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <li><a href="#about" className="footer-link">About Us</a></li>
              <li><a href="#services" className="footer-link">Our Services</a></li>
              <li><a href="#facilities" className="footer-link">Facilities</a></li>
              <li><a href="#contact" className="footer-link">Contact Us</a></li>
              <li><Link to="/login" className="footer-link">Staff Login</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div style={{ flex: '1 1 200px' }}>
            <h3 className="footer-title">Legal</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <li><a href="#privacy" className="footer-link">Privacy Policy</a></li>
              <li><a href="#terms" className="footer-link">Terms of Service</a></li>
              <li><a href="#patient-rights" className="footer-link">Patient Rights</a></li>
            </ul>
          </div>

        </div>
        
        <div className="page-shell" style={{ marginTop: '4rem', paddingTop: '1.5rem', borderTop: '1px solid #334155', textAlign: 'center', color: '#64748b' }}>
          <p>&copy; {new Date().getFullYear()} Pascual General Hospital. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

export default HomePage;
