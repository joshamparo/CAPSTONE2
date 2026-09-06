import React, { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./HomePage.css";
import "../components/AccountHeaderActions.css";
import SignOutConfirmModal from "../components/SignOutConfirmModal";
import PrivacyConsentModal, { hasPrivacyConsent } from "../components/PrivacyConsentModal";
import { Phone, Bone, Stethoscope, MapPin, Mail, Clock, Facebook, MessageCircle, Scissors, Syringe, Baby, Ear, Microscope, Smile, Eye, Scan, Droplet, Sparkles, ShieldCheck, Users, HeartPulse, Building2, BadgeCheck, ChevronLeft, ChevronRight, Pause, Play, Menu, X } from "lucide-react";
import { buildAuthHeaders } from "../utils/api";

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
const HOSPITAL_LOCATION = {
  name: "Pascual General Hospital",
  address: "Pascual General Hospital, Novaliches, Quezon City, Metro Manila",
  latitude: 14.666991,
  longitude: 121.0090838
};
const GOOGLE_MAPS_PLACE_URL = "https://www.google.com/maps/place/Pascual+General+Hospital/@14.6670465,121.0081596,225m/data=!3m1!1e3!4m6!3m5!1s0x3397b695162c8be5:0xc37a34c97bbe0f67!8m2!3d14.666991!4d121.0090838!16s%2Fg%2F1tjgxx8x";
const GOOGLE_MAPS_EMBED_URL = `https://maps.google.com/maps?hl=en&q=${HOSPITAL_LOCATION.latitude},${HOSPITAL_LOCATION.longitude}%20(${encodeURIComponent(HOSPITAL_LOCATION.name)})&z=21&t=k&iwloc=B&output=embed`;

const DASHBOARD_PATH_BY_ROLE = {
  admin: '/admin',
  staff: '/admin',
  patient: '/patient',
  doctor: '/doctor',
  nurse: '/nurse',
  pharmacist: '/pharmacist',
  cashier: '/cashier',
  doctor_secretary: '/doctor-secretary',
  medtech: '/medtech',
  radiographer: '/radiographer',
  ecg_operator: '/ecg',
  physical_therapist: '/pt'
};

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
    image: "/images/hospital-pharmacy-800.jpg",
    title: "Pharmacy Support",
    text: "Accessible medicine support and dependable coordination for daily patient needs."
  },
  {
    image: "/images/hospital-interior-800.jpg",
    title: "Organized Care Environment",
    text: "A clean and structured hospital interior designed to support safe workflows."
  },
  {
    image: "/images/hospital-service-window-800.jpg",
    title: "Convenient Service Points",
    text: "Welcoming service areas that help visitors find assistance and information quickly."
  }
];

const slides = [
  {
    image: "/images/hospital-main-1600.jpg",
    mobileImage: "/images/hospital-main-800.jpg",
    title: "Pascual General Hospital",
    subtitle: "Trusted care, guided by compassion and innovation."
  },
  {
    image: "/images/hospital-emergency-1600.jpg",
    mobileImage: "/images/hospital-emergency-800.jpg",
    title: "Emergency Services",
    subtitle: "Ready to respond when every second matters."
  },
  {
    image: "/images/hospital-pharmacy-1600.jpg",
    mobileImage: "/images/hospital-pharmacy-800.jpg",
    title: "Hospital Pharmacy",
    subtitle: "Safe dispensing and reliable support for patient care."
  },
  {
    image: "/images/hospital-interior-1600.jpg",
    mobileImage: "/images/hospital-interior-800.jpg",
    title: "Inside the Hospital",
    subtitle: "A safe and organized environment for patients and staff."
  },
  {
    image: "/images/hospital-service-window-1600.jpg",
    mobileImage: "/images/hospital-service-window-800.jpg",
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

const OFFICIAL_NEWS_FALLBACK = [
  { id: 'philhealth-latest', category: 'Philippine Health', label: 'PhilHealth', source: 'PhilHealth', title: 'Latest official PhilHealth news and advisories', summary: 'Browse verified benefit, primary-care, medicine-access, and member-service updates directly from PhilHealth.', url: 'https://www.philhealth.gov.ph/news/', imageUrl: '', publishedAt: null },
  { id: 'who-philippines-latest', category: 'Philippine Health', label: 'WHO Philippines', source: 'World Health Organization', title: 'Latest official health releases from WHO Philippines', summary: 'Read verified public-health releases, statements, and joint updates from the WHO country office in the Philippines.', url: 'https://www.who.int/philippines/news/releases', imageUrl: '', publishedAt: null },
  { id: 'who-global-latest', category: 'Global Health', label: 'WHO', source: 'World Health Organization', title: 'Latest global public-health news from WHO', summary: 'Read current health guidance, emergency updates, research announcements, and official statements from WHO.', url: 'https://www.who.int/news-room/', imageUrl: '', publishedAt: null }
];

function pickNewsImage(item, index) {
  const directImage = String(item?.imageUrl || '').trim();
  if (/^https:\/\//i.test(directImage)) return directImage;

  const basis = String(item?.url || item?.title || index);
  const hash = Array.from(basis).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return NEWS_FALLBACK_IMAGES[hash % NEWS_FALLBACK_IMAGES.length];
}

function formatNewsDate(value) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function HomePage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [user, setUser] = useState(null);
  const [activeServiceGroup, setActiveServiceGroup] = useState('all');
  const [showAllServices, setShowAllServices] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [newsItems, setNewsItems] = useState(OFFICIAL_NEWS_FALLBACK);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState('');
  const [newsCursor, setNewsCursor] = useState(0);
  const [newsPaused, setNewsPaused] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(() => !hasPrivacyConsent());
  const navigate = useNavigate();

  useEffect(() => {
    // Check for logged in user
    const storedUser = localStorage.getItem('currentUser');
    let parsedSession = null;
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        parsedSession = parsedUser;
        // Keep the same role fallbacks used by authentication and protected routes.
        const name = parsedUser.first_name ? `${parsedUser.first_name}` : (parsedUser.name || 'Staff');
        setUser({
          ...parsedUser,
          name,
          accountType: parsedUser.account_type || parsedUser.accountType || parsedUser.role || parsedUser.roles,
        });
      } catch (error) {
        console.error('Failed to restore the current user session:', error);
        localStorage.removeItem('currentUser');
      }
    }

    const sessionController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (parsedSession?.sessionToken && parsedSession?.email) {
      fetch(`${API_BASE}/api/staff/by-email?email=${encodeURIComponent(parsedSession.email)}`, {
        headers: buildAuthHeaders(parsedSession),
        signal: sessionController?.signal
      }).then((response) => {
        if (![401, 403, 404].includes(response.status)) return;
        localStorage.removeItem('currentUser');
        setUser(null);
      }).catch(() => {
        // Preserve the last known session during temporary network outages.
      });
    }

    const slideInterval = setInterval(() => {
      setCurrentSlide((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
    }, 5000);
    return () => {
      clearInterval(slideInterval);
      sessionController?.abort();
    };
  }, []);

  useEffect(() => {
    const closeAtDesktopWidth = () => {
      if (window.innerWidth > 768) setMobileNavOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('resize', closeAtDesktopWidth);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', closeAtDesktopWidth);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;
    const loadOfficialNews = async () => {
      setNewsLoading(true);
      setNewsError('');
      try {
        const response = await fetch(`${API_BASE}/api/announcements/news?limit=6`, controller ? { signal: controller.signal } : undefined);
        const data = await response.json().catch(() => []);
        if (!response.ok || !Array.isArray(data) || data.length === 0) throw new Error('Official news feed is unavailable.');
        const trusted = data.filter((item) => {
          try {
            const host = new URL(String(item?.url || '')).hostname.toLowerCase();
            return ['who.int', 'www.who.int', 'philhealth.gov.ph', 'www.philhealth.gov.ph'].includes(host);
          } catch (_) {
            return false;
          }
        });
        if (!trusted.length) throw new Error('Official news feed returned no trusted links.');
        setNewsItems(trusted);
      } catch (error) {
        setNewsError(error?.name === 'AbortError'
          ? 'Showing verified official links because the live feed timed out.'
          : 'Showing verified official links while the live feed refreshes.');
        setNewsItems(OFFICIAL_NEWS_FALLBACK);
      } finally {
        setNewsLoading(false);
      }
    };
    loadOfficialNews();
    return () => {
      if (timer) clearTimeout(timer);
      if (controller) controller.abort();
    };
  }, []);

  useEffect(() => {
    if (newsLoading || newsPaused) return;
    const len = Array.isArray(newsItems) ? newsItems.length : 0;
    if (len <= 3) return;
    const t = setInterval(() => {
      setNewsCursor((prev) => (prev + 1) % len);
    }, 8000);
    return () => clearInterval(t);
  }, [newsItems, newsLoading, newsPaused]);

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
    let storedUser = null;
    try {
      storedUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch (_) {}
    const userId = storedUser?.id || storedUser?._id;
    if (storedUser && userId && storedUser.sessionToken) {
        try {
            const role = String(storedUser.account_type || storedUser.accountType || storedUser.role || '').toLowerCase();
            await fetch(`${API_BASE}/api/staff/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(storedUser, role) },
                body: JSON.stringify({ 
                    id: userId,
                    accountType: role
                })
            });
        } catch (error) {
            console.error("Failed to notify backend of logout:", error);
        }
    }
    localStorage.removeItem('currentUser');
    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    setMobileNavOpen(false);
    setUser(null);
    navigate('/');
  };

  const closeMobileNav = () => setMobileNavOpen(false);

  const handleGoToDashboard = () => {
    const role = String(user?.accountType || user?.account_type || user?.role || user?.roles || '')
      .trim()
      .toLowerCase();
    navigate(DASHBOARD_PATH_BY_ROLE[role] || '/login');
  };

  return (
    <div className="homepage">
      <header className="main-header">
        <div className="header-container">
          <div className="header-mobile-row">
            <a className="logo-section" href="#top" onClick={closeMobileNav} aria-label="Pascualinga homepage">
              <img src={process.env.PUBLIC_URL + "/images/pgh-logo-128.png"} alt="" className="logo-img" width="128" height="128" />
              <div className="logo-text">
                <div className="logo-name">PASCUALINGA</div>
                <span>Pascual General Hospital</span>
              </div>
            </a>
            <button
              type="button"
              className="mobile-menu-toggle"
              aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileNavOpen}
              aria-controls="homepage-navigation"
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {mobileNavOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
          <nav id="homepage-navigation" className={`main-nav ${mobileNavOpen ? 'is-open' : ''}`} aria-label="Primary navigation">
            <a href="#about" onClick={closeMobileNav}>About Us</a>
            <a href="#services" onClick={closeMobileNav}>Our Services</a>
            <a href="#facilities" onClick={closeMobileNav}>Facilities</a>
            <a href="#news" onClick={closeMobileNav}>News</a>
            <a href="#contact" onClick={closeMobileNav}>Contact Us</a>
            {user ? (
              <div className="user-greeting-wrapper">
                <span className="nav-user-greeting">
                  Hello, {user.name}
                </span>
                <button onClick={() => { closeMobileNav(); handleGoToDashboard(); }} className="nav-btn-primary">
                  Dashboard
                </button>
                <button onClick={() => { closeMobileNav(); setShowLogoutConfirm(true); }} className="nav-btn-danger">
                  Logout
                </button>
              </div>
            ) : (
              <Link to="/login" className="nav-btn-primary" onClick={closeMobileNav}>Staff Login</Link>
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

      <main id="top">
      <section className="hero">
        {slides.map((slide, index) => (
          <div
            key={index}
            className={`hero-slide ${index === currentSlide ? "active" : ""}`}
          >
            <picture>
              <source media="(max-width: 768px)" srcSet={process.env.PUBLIC_URL + slide.mobileImage} />
              <img
                src={process.env.PUBLIC_URL + slide.image}
                alt={slide.title}
                className="hero-img"
                width="1600"
                height="1200"
                loading={index === 0 ? 'eager' : 'lazy'}
                fetchPriority={index === 0 ? 'high' : 'auto'}
                decoding="async"
              />
            </picture>
          </div>
        ))}
        <div className="hero-overlay" />
        <div className="hero-shell">
          <div className="hero-layout page-shell">
            <div className="hero-panel reveal-on-scroll">
              <div className="eyebrow">Private Hospital Care</div>
              <div className="hero-content-panel">
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
        <div className="reveal-on-scroll">
          <h2 className="section-title">Our Services</h2>
          <p className="section-subtitle mx-auto">Explore key hospital services through a clear, patient-friendly service overview.</p>
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
            <p className="section-subtitle mx-auto">A private hospital experience that stays warm, reliable, and easy to understand.</p>
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
            <picture>
              <source media="(max-width: 768px)" srcSet={process.env.PUBLIC_URL + "/images/hospital-about-700.jpg"} />
              <img
                src={process.env.PUBLIC_URL + "/images/hospital-about-1200.jpg"}
                alt="About Pascual General Hospital"
                width="1200"
                height="675"
                loading="lazy"
                decoding="async"
              />
            </picture>
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
            <div className="eyebrow">Hospital Environment</div>
            <h2 className="section-title">A care environment that feels capable, organized, and welcoming.</h2>
            <p className="section-subtitle mx-auto">
              Real hospital visuals help visitors understand the setting before they arrive, reinforcing trust and a sense of readiness.
            </p>
          </div>
          <div className="care-grid">
          {careEnvironmentCards.map((card, index) => (
            <div key={card.title} className={`care-card reveal-on-zoom reveal-delay-${(index % 4) + 1}`}>
                <div className="care-card-image">
                  <img src={process.env.PUBLIC_URL + card.image} alt={card.title} width="800" height="600" loading="lazy" decoding="async" />
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
      <section className="news-section page-section" id="news" onMouseEnter={() => setNewsPaused(true)} onMouseLeave={() => setNewsPaused(false)}>
        <div className="page-shell">
          <div className="news-head reveal-on-scroll">
            <div className="eyebrow">Current Updates</div>
            <h2 className="section-title">News & Health Updates</h2>
            <p className="section-subtitle mx-auto">
              Live news links from legitimate online publishers, with health and public-interest stories prioritized.
            </p>
          </div>
          
          <div className="news-grid">
            {newsError ? (
              <div className="news-error-msg" role="status">{newsError}</div>
            ) : null}

            {!newsLoading && newsItems.length > 3 ? (
              <div className="news-controls" aria-label="News carousel controls">
                <button type="button" onClick={() => setNewsCursor((current) => (current - 1 + newsItems.length) % newsItems.length)} aria-label="Previous news articles"><ChevronLeft size={18} /></button>
                <span>{newsCursor + 1} / {newsItems.length}</span>
                <button type="button" onClick={() => setNewsPaused((paused) => !paused)} aria-label={newsPaused ? 'Resume news rotation' : 'Pause news rotation'}>{newsPaused ? <Play size={16} /> : <Pause size={16} />}</button>
                <button type="button" onClick={() => setNewsCursor((current) => (current + 1) % newsItems.length)} aria-label="Next news articles"><ChevronRight size={18} /></button>
              </div>
            ) : null}

            {!newsLoading && !visibleNews.length ? (
              <div className="news-empty-msg">
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
              const publishedDate = formatNewsDate(n?.publishedAt);

              const badgeStyleByCategory = {
                'Philippine News': { bg: '#ffedd5', fg: '#c2410c' },
                'Health & Lifestyle': { bg: '#dcfce7', fg: '#15803d' }
              };
              const badge = badgeStyleByCategory[cat] || badgeStyleByCategory['Philippine News'];

              return (
                <div key={n?.id || idx} className={`news-card reveal-on-scroll reveal-delay-${(idx % 3) + 1}`}>
                  <div className="news-card-image">
                    <img src={img} alt={`${title || cat || 'Official health'} news`} loading="lazy" width="900" height="480" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/images/hero_bg.jpg'; }} />
                  </div>
                  <div className="news-card-body">
                    <div className="news-card-meta">
                      <span className="news-label" style={{ background: badge.bg, color: badge.fg }}>{label}</span>
                      <span className="news-source">{source || cat || 'Philippines'}</span>
                      {publishedDate ? <time className="news-date" dateTime={String(n.publishedAt)}>{publishedDate}</time> : null}
                    </div>

                    {newsLoading ? (
                      <div className="news-skeleton">
                        <div className="skeleton-title" />
                        <div className="skeleton-text" />
                        <div className="skeleton-text short" />
                        <div className="skeleton-link" />
                      </div>
                    ) : (
                      <>
                        <h3 className="news-title">{title}</h3>
                        <p className="news-summary">{summary}</p>
                        <a href={url} target="_blank" rel="noopener noreferrer" className="news-read-more">
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

      <section className="public-information-section page-section" aria-labelledby="public-information-title">
        <div className="page-shell">
          <div className="public-information-head reveal-on-scroll">
            <div className="eyebrow">Public Information</div>
            <h2 id="public-information-title" className="section-title">Privacy, terms, and patient rights</h2>
            <p className="section-subtitle">A concise guide for visitors using Pascualinga's public website.</p>
          </div>
          <div className="public-information-grid">
            <article id="privacy" className="public-information-card reveal-on-scroll">
              <h3>Privacy Policy</h3>
              <p>Personal and health information submitted through Pascualinga is used only to provide and coordinate authorized hospital services. For privacy questions or data requests, contact the hospital directly.</p>
            </article>
            <article id="terms" className="public-information-card reveal-on-scroll reveal-delay-1">
              <h3>Terms of Service</h3>
              <p>Public website information is provided for general guidance and does not replace professional medical advice, diagnosis, or emergency care. Contact the hospital for service confirmation.</p>
            </article>
            <article id="patient-rights" className="public-information-card reveal-on-scroll reveal-delay-2">
              <h3>Patient Rights</h3>
              <p>Patients have the right to respectful care, clear information, privacy, and participation in decisions about their care. Concerns may be raised directly with authorized hospital personnel.</p>
            </article>
          </div>
        </div>
      </section>

      {/* Emergency Banner (Moved to bottom) */}
      <section className="emergency-banner-improved page-section">
        <div className="emergency-content-improved reveal-on-scroll">
          <div className="banner-info">
            <h2 className="banner-title">Need Immediate Care?</h2>
            <p className="banner-text">Our emergency department is staffed 24/7 with specialists ready to handle any critical situation.</p>
          </div>
          <div className="banner-cta">
            <div className="banner-icon-box">
              <Phone size={32} fill="white" />
            </div>
            <div className="banner-cta-text">
              <div className="banner-label">Emergency Dial</div>
              <div className="banner-number">0915 312 7144</div>
            </div>
          </div>
        </div>
      </section>
      </main>

      {/* Global Footer */}
      <footer className="global-footer page-section">
        <div className="page-shell footer-grid reveal-on-scroll">
          
          {/* Brand & Socials */}
          <div className="footer-brand">
            <div className="footer-logo-box">
              <img src={process.env.PUBLIC_URL + "/images/pgh-logo-128.png"} alt="PGH Logo" className="footer-logo-img" width="128" height="128" loading="lazy" decoding="async" />
              <h2 className="footer-brand-name">PASCUALINGA</h2>
            </div>
            <p className="footer-brand-desc">
              Trusted care, guided by compassion and innovation. Your health and safety are our top priorities.
            </p>
          </div>

          <div className="footer-nav-groups">
            {/* Quick Links */}
            <nav className="footer-links-col" aria-label="Footer quick links">
              <h3 className="footer-title">Quick Links</h3>
              <ul className="footer-links-list">
                <li><a href="#about" className="footer-link">About Us</a></li>
                <li><a href="#services" className="footer-link">Our Services</a></li>
                <li><a href="#facilities" className="footer-link">Facilities</a></li>
                <li><a href="#contact" className="footer-link">Contact Us</a></li>
                <li><Link to="/login" className="footer-link">Staff Login</Link></li>
              </ul>
            </nav>

            {/* Legal */}
            <nav className="footer-links-col" aria-label="Legal information">
              <h3 className="footer-title">Legal</h3>
              <ul className="footer-links-list">
                <li><a href="#privacy" className="footer-link" onClick={(event) => { event.preventDefault(); setPrivacyOpen(true); }}>Privacy Policy</a></li>
                <li><a href="#terms" className="footer-link">Terms of Service</a></li>
                <li><a href="#patient-rights" className="footer-link">Patient Rights</a></li>
              </ul>
            </nav>
          </div>

        </div>
        
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} Pascual General Hospital. All rights reserved.</p>
        </div>
      </footer>
      <PrivacyConsentModal
        open={privacyOpen}
        onAccept={() => setPrivacyOpen(false)}
        onDecline={() => setPrivacyOpen(false)}
      />
    </div>
  );
}

export default HomePage;
