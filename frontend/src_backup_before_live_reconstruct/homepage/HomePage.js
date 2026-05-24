import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./HomePage.css";
import {
  Phone,
  FlaskConical,
  TestTube,
  Activity,
  Bone,
  Waves,
  Stethoscope,
  PersonStanding,
} from "lucide-react";

const services = [
  { icon: <FlaskConical size={48} />, title: "Blood Chemistry", desc: "Professional lab testing for health monitoring." },
  { icon: <TestTube size={48} />, title: "Urinalysis", desc: "Comprehensive diagnostic urine analysis." },
  { icon: <Activity size={48} />, title: "ECG", desc: "Heart monitoring with modern technology." },
  { icon: <Bone size={48} />, title: "X-Ray", desc: "High-resolution imaging for diagnostics." },
  { icon: <Waves size={48} />, title: "Ultrasound", desc: "Safe and effective internal imaging." },
  { icon: <Stethoscope size={48} />, title: "Clinic", desc: "Consultations with experienced physicians." },
  { icon: <PersonStanding size={48} />, title: "Physical Therapy", desc: "Rehabilitative care for your mobility." },
];

const slides = [
  {
    image: "/images/IMG_20260126_104733_949.jpg",
    title: "PASCUALINGA",
    subtitle: "Trusted care, guided by compassion and innovation."
  },
  {
    image: "/images/IMG_20260126_112706_079.jpg",
    title: "Inside the Hospital",
    subtitle: "Dedicated professionals, your health partners."
  },
  {
    image: "/images/IMG_20260126_112858_791.jpg",
    title: "Modern Facilities",
    subtitle: "Equipped with the latest medical technology for your safety."
  }
];

function HomePage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  // SECTION REFS
  const aboutRef = useRef(null);
  const servicesRef = useRef(null);
  const contactRef = useRef(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("currentUser");
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }

    const slideInterval = setInterval(() => {
      setCurrentSlide((prev) =>
        prev === slides.length - 1 ? 0 : prev + 1
      );
    }, 5000);

    return () => clearInterval(slideInterval);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("currentUser");
    setUser(null);
  };

  // SMOOTH SCROLL FUNCTION (WITH OFFSET)
  const scrollToSection = (ref) => {
    const yOffset = -100;
    const y =
      ref.current.getBoundingClientRect().top +
      window.pageYOffset +
      yOffset;

    window.scrollTo({ top: y, behavior: "smooth" });
  };

  return (
    <div className="homepage">
      {/* TOP BAR */}
      <div className="top-bar">
        <span>Emergency? Dial</span>
        <Phone size={16} fill="white" />
        <span>123456789</span>
      </div>

      {/* HEADER */}
      <header className="main-header">
        <div className="header-container">
          <div className="logo-section">
            <img
              src={process.env.PUBLIC_URL + "/images/pgh logo.png"}
              alt="PGH Logo"
              className="logo-img"
            />
            <div className="logo-text">
              <h1>PASCUALINGA</h1>
              <span>Pascual General Hospital</span>
            </div>
          </div>

          <nav className="main-nav">
            <button className="nav-link" onClick={() => scrollToSection(aboutRef)}>
              About Us
            </button>

            <button className="nav-link" onClick={() => scrollToSection(servicesRef)}>
              Our Services
            </button>

            <button className="nav-link" onClick={() => scrollToSection(contactRef)}>
              Contact Us
            </button>

            {user ? (
              <div className="user-greeting-wrapper">
                <span className="nav-user-greeting">
                  Hello, {user.name}
                </span>
                <button onClick={handleLogout} className="nav-logout">
                  Logout
                </button>
              </div>
            ) : (
              <Link to="/login" className="nav-login">
                Login
              </Link>
            )}

            <button className="nav-find-doctor">Find a Doctor</button>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="hero" ref={aboutRef}>
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
            <div className="hero-content">
              <h1 className="hero-title">{slide.title}</h1>
              <p className="hero-subtitle">{slide.subtitle}</p>
              <div className="hero-buttons">
                <button className="btn btn-primary">Discover More</button>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* EMERGENCY INFO BANNER */}
      <div className="emergency-banner">
        <div className="banner-content">
          <div className="banner-section">
            <h2>Pascual General Hospital's<br />Emergency Hotline</h2>
            <p>For emergency cases, you can call our hotline:</p>
            <div className="banner-phone">
              <Phone size={28} fill="white" />
              <span>123456789</span>
            </div>
          </div>
          
          <div className="banner-divider"></div>

          <div className="banner-section">
            <h2>For Walk In's,</h2>
            <p>Please always wear your mask and keep pocket sanitizers or alcohol when you visit a doctor to keep the environment healthy.</p>
          </div>
        </div>
      </div>

      {/* SERVICES */}
      <section ref={servicesRef} className="services-section">
        <h2 className="section-title">Our Services</h2>
        <div className="services-grid">
          {services.map((service, index) => (
            <div key={index} className="service-card">
              <div className="service-icon">{service.icon}</div>
              <h4>{service.title}</h4>
              <p>{service.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CONTACT */}
      <section ref={contactRef} style={{ padding: "100px 20px", textAlign: "center" }}>
        <h2>Contact Us</h2>
        <p>Email: info@pascualgeneralhospital.com</p>
        <p>Phone: 123456789</p>
      </section>
    </div>
  );
}

export default HomePage;
