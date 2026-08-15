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

const TAGLISH_SLANG_MAP = [
  [/b(g?)ruh?\b/gi, ''],
  [/\bmg?kano\b/gi, 'magkano'],
  [/\bmg?kanu\b/gi, 'magkano'],
  [/\bpresyo\b/gi, 'magkano bayad'],
  [/\bpde\b/gi, 'pwede'],
  [/\bpuwedeng\b/gi, 'pwede bang'],
  [/\bmgtnong\b/gi, 'magtanong'],
  [/\bpwd\b/gi, 'pwede'],
  [/\bdok\b/gi, 'doctor'],
  [/\bdoktor\b/gi, 'doctor'],
  [/\bdra?\b/gi, 'doctor'],
  [/\bpatulong\b/gi, 'paki tulungan'],
  [/\btnong\b/gi, 'tanong'],
  [/\bklinika\b/gi, 'clinic hospital'],
  [/\bospital\b/gi, 'hospital'],
  [/\bospital\b/gi, 'hospital'],
  [/\bcheck?up\b/gi, 'check up consultation'],
  [/\bchek?ap\b/gi, 'check up consultation'],
  [/\bfollowup\b/gi, 'follow up check up'],
  [/\bmagpacheckup\b/gi, 'magpa check up consultation'],
  [/\blagnat\b/gi, 'lagnat fever sintomas'],
  [/\bsipon\b/gi, 'sipon cold sintomas'],
  [/\bubo\b/gi, 'ubo cough sintomas'],
  [/\bsakit\b/gi, 'sakit pain sintomas'],
  [/\bmasakit\b/gi, 'masakit painful sintomas'],
  [/\bnahihilo\b/gi, 'nahihilo dizzy sintomas'],
  [/\bdugo\b/gi, 'dugo bleeding sintomas'],
  [/\bhinihingal\b/gi, 'hinihingal shortness of breath sintomas'],
  [/\bdibdib\b/gi, 'dibdib chest'],
  [/\bnilalagnat\b/gi, 'nilalagnat fever sintomas'],
  [/\btx?nong\b/gi, 'tanong'],
  [/\bspraning?\b/gi, 'sprain'],
  [/\bpilay\b/gi, 'pilay sprain fracture ortho'],
  [/\bbali\b/gi, 'bali fracture ortho sintomas'],
  [/\btae\b/gi, 'diarrhea tiyan sintomas'],
  [/\btae ng tae\b/gi, 'diarrhea tiyan sintomas'],
  [/\bsuka\b/gi, 'suka vomit sintomas'],
  [/\bnagsusuka\b/gi, 'nagsusuka vomit sintomas'],
  [/\btiyan\b/gi, 'tiyan stomach abdomen sintomas'],
  [/\bpulmonya\b/gi, 'pulmonya pneumonia sintomas'],
  [/\bhepa\b/gi, 'hepatitis liver sintomas'],
  [/\bdengue\b/gi, 'dengue fever sintomas'],
  [/\brashes\b/gi, 'rashes skin sintomas'],
  [/\bbutlig\b/gi, 'butlig rashes skin sintomas'],
  [/\bmakati\b/gi, 'makati itchy skin sintomas'],
  [/\balta?s\b/gi, 'blood pressure alta presyon'],
  [/\bpresyon\b/gi, 'presyon blood pressure'],
  [/\bdiyabetis\b/gi, 'diabetes blood sugar sintomas'],
  [/\bbwelta\b/gi, 'hypertension alta sintomas'],
  [/\bpayo\b/gi, 'advice tulong'],
  [/\bgamot\b/gi, 'gamot medicine'],
  [/\bmagkano bay\b/gi, 'magkano bayad'],
  [/\banu\b/gi, 'ano'],
  [/\banu ba\b/gi, 'ano ba'],
  [/\bpa2no\b/gi, 'paano'],
  [/\bpano\b/gi, 'paano'],
  [/\bsaan\b/gi, 'saan lokasyon'],
  [/\btawag\b/gi, 'tawag contact'],
  [/\bkantak\b/gi, 'kontak contact'],
  [/\bkontak\b/gi, 'contact'],
  [/\blibre\b/gi, 'libre free'],
  [/\bdiskwento\b/gi, 'discount'],
  [/\bsenior\b/gi, 'senior citizen discount'],
  [/\bphilhealth\b/gi, 'philhealth insurance HMO'],
  [/\bhealthcard\b/gi, 'healthcard HMO insurance'],
  [/\bhmo\b/gi, 'HMO health card insurance'],
  [/\bgawa\b/gi, 'gawa procedure'],
  [/\bnurse\b/gi, 'nurse hospital staff'],
  [/\bped?ya\b/gi, 'pediatrics bata bata'],
  [/\bpedia\b/gi, 'pediatrics bata'],
  [/\bbata\b/gi, 'bata pediatrics patient'],
  [/\bbaby\b/gi, 'baby pediatrics patient'],
  [/\bmatanda\b/gi, 'matanda geriatrics'],
  [/\bnaluluha\b/gi, 'mata eye sintomas ophthalmology'],
  [/\belem?\b/gi, 'ENT lalamunan ilong tenga'],
  [/\btenga\b/gi, 'tenga ear sintomas ENT'],
  [/\bilong\b/gi, 'ilong nose sintomas ENT'],
  [/\blalamunan\b/gi, 'lalamunan throat sintomas ENT'],
  [/\bngipin\b/gi, 'ngipin teeth dental sintomas dentistry'],
  [/\bbunot ng ngipin\b/gi, 'tooth extraction dental'],
  [/\bpasta\b/gi, 'dental filling pasta ngipin'],
  [/\bbutas ng ngipin\b/gi, 'dental cavity filling pasta ngipin'],
  [/\bortho\b/gi, 'orthopedics bones pilay bali'],
  [/\bpaki explain\b/gi, 'paki paliwanag'],
  [/\bpano po\b/gi, 'paano po'],
  [/\bsalamat?\b/gi, 'salamat thank you'],
  [/\bgud?mornin\b/gi, 'good morning'],
  [/\bgud?hapun\b/gi, 'good afternoon'],
  [/\bgud?pm\b/gi, 'good afternoon'],
  [/\bgud?gabi\b/gi, 'good evening'],
  [/\bmeron\b/gi, 'mayroon available'],
  [/\bmy ron\b/gi, 'mayroon available'],
  [/\bmyron\b/gi, 'mayroon available'],
  [/\bme ron\b/gi, 'mayroon available'],
  [/\bwala\b/gi, 'wala unavailable'],
  [/\bmron\b/gi, 'mayroon available'],
  [/\byung\b/gi, 'iyung ang'],
  [/\byung mga\b/gi, 'ang mga'],
  [/\bkasi\b/gi, 'kasi dahil'],
  [/\bdahil sa\b/gi, 'kasi'],
  [/\bkc\b/gi, 'kasi'],
  [/\blang\b/gi, 'lamang'],
  [/\blng\b/gi, 'lamang'],
  [/\bnamn\b/gi, 'naman'],
  [/\btalaga\b/gi, 'talaga sigurado'],
  [/\bsge\b/gi, 'sige okay'],
  [/\bsge\s*na\b/gi, 'sige na okay'],
  [/\boky\b/gi, 'okay ayos'],
  [/\boks\b/gi, 'okay ayos'],
  [/\bayos\b/gi, 'okay ayos'],
  [/\bano po\b/gi, 'ano po'],
  [/\bsakin\b/gi, 'sa akin'],
  [/\bsaiyo\b/gi, 'sa iyo'],
  [/\bsainyo\b/gi, 'sa inyo'],
  [/\bmag 15\b/gi, 'consultation check up'],
  [/\bmagparehistro\b/gi, 'magpa rehistro register appointment walk in'],
  [/\bpa register\b/gi, 'magpa rehistro register walk in'],
  [/\bmagparen\b/gi, 'magpa rehistro register'],
  [/\bmagpaadmit\b/gi, 'hospital admission admit'],
  [/\bconfine\b/gi, 'hospital confinement admit admit sa ospital'],
  [/\bipadala\b/gi, 'ipadala submit'],
  [/\brekwest\b/gi, 'request'],
  [/\bmed?cert\b/gi, 'medical certificate'],
  [/\bmedisert\b/gi, 'medical certificate'],
  [/\blisensya\b/gi, 'lisensya license'],
  [/\bfit to work\b/gi, 'fit to work medical certificate'],
  [/\bcertificate\b/gi, 'sertipiko certificate'],
  [/\bpekeng\b/gi, ''],
  [/\bpeke\b/gi, ''],
  [/\bhi n di\b/gi, 'hindi'],
  [/\bkhit\b/gi, 'kahit'],
  [/\bkatulad\b/gi, 'gaya parehas'],
  [/\bparehas\b/gi, 'parehas same'],
  [/\bpareho\b/gi, 'parehas same'],
  [/\bmgaparehistro\b/gi, 'magparehistro register'],
  [/\bschedule?\b/gi, 'iskedyul schedule appointment'],
  [/\bskedyul\b/gi, 'iskedyul schedule appointment'],
  [/\bappt\b/gi, 'appointment'],
  [/\bapointment\b/gi, 'appointment'],
  [/\bwalk?in\b/gi, 'walk in on site booking'],
  [/\bonline sched\b/gi, 'online appointment schedule'],
  [/\bhome servis\b/gi, 'home service house call'],
  [/\bhouse call\b/gi, 'house call home service doctor visit'],
  [/\bmensahe\b/gi, 'message'],
  [/\btext\b/gi, 'message text sms'],
  [/\bcall\b/gi, 'tawag call phone contact'],
  [/\btawagan\b/gi, 'tawagan call contact'],
  [/\bcp\b/gi, 'cellphone mobile phone contact'],
  [/\bselpon\b/gi, 'cellphone phone contact'],
  [/\bcelphone\b/gi, 'cellphone contact phone'],
  [/\bemail add\b/gi, 'email address contact'],
  [/\bfb\b/gi, 'facebook page contact hospital'],
  [/\bgmap\b/gi, 'google maps lokasyon address'],
  [/\baddress\b/gi, 'address lokasyon location'],
  [/\blokasyon\b/gi, 'location address lugar'],
  [/\blugar\b/gi, 'lugar location address'],
  [/\bgate? 2\b/gi, ''],
  [/\bmalapit ba\b/gi, 'location proximity'],
  [/\bbukas\b/gi, 'bukas open tomorrow operating hours'],
  [/\bsarado\b/gi, 'sarado closed operating hours'],
  [/\bang oras\b/gi, 'oras operating hours schedule'],
  [/\banong oras\b/gi, 'operating hours oras schedule time'],
  [/\b11 pm\b/gi, 'late operating hours night schedule'],
  [/\ber\b/gi, 'emergency room ER 24 7'],
  [/\bemergency\b/gi, 'emergency urgent 911 24 7'],
  [/\b247\b/gi, '24 7 open daily'],
  [/\b24 7\b/gi, '24 7 open daily emergency'],
  [/\bcsr\b/gi, 'customer service hotline contact'],
  [/\bhotline\b/gi, 'hotline contact number emergency'],
  [/\btelepono\b/gi, 'telephone landline contact number'],
  [/\bpest\s*control\b/gi, '']
];

const SYMPTOM_TRIAGE_RULES = [
  {
    level: 'RED',
    keywords: ['stroke', 'cerebrovascular', 'heart attack', 'myocardial', 'cardiac arrest', 'cpr', 'drowning', 'unconscious', 'hinihingal nang malala', 'hindi makahinga', 'hindi makapagsalita', 'paninikip ng dibdib', 'chest pain severe', 'dugo ang dumi', 'coughing blood', 'vomiting blood', 'dugo sa suka', 'baby kulang buwan', 'preterm labor', 'convulsion', 'kombulsyon', 'seizure', 'nanginginig ang buong katawan', 'head trauma', 'nahulog mataas', 'nalaglag mula sa mataas na lugar', 'sugat malalim', 'deep laceration', 'suicide attempt', 'overdose', 'sobrang sakit ng ulo', 'pinakamasakit na sakit ng ulo', 'panghihina ng isang bahagi ng katawan', 'panghihina ng kaliwa o kanang kamay o paa', 'nahihirapang magsalita', 'slurred speech', 'double vision', 'bulag bigla', 'biglang hindi makakita', 'buntis dugo', 'pregnant bleeding', 'placenta previa', 'eclampsia', 'high risk pregnancy', 'acute abdomen', 'stabbing abdominal pain', 'acute surgical abdomen', 'anaphylaxis', 'pamamaga ng labi', 'pamamaga ng dila', 'hirap huminga pagkatapos kumain', 'allergic reaction severe', 'shortness of breath sudden', 'hinihingal bigla', 'pulmonary embolism', 'fast breathing baby', 'grunting baby', 'indrawing', 'sepsis', 'shock', 'pale cold clammy skin', 'malamig na pawis malala'],
    response: {
      en: '⚠️ MAARING EMERGENCY ITO — HUWAG MAGHINTAY. TUMAWAG AGAD SA EMERGENCY HOTLINE NG PASCUAL GENERAL HOSPITAL: 0915 312 7144. Maaari rin pong pumunta AGAD sa Pinakamalapit na Emergency Room (ER 24/7 bukas). Ang symptoms na ito ay kailangan ng agarang medikal na atensyon. Huwag munang uminom ng gamot nang walang payo ng doktor.',
      tl: '⚠️ MAARING EMERGENCY ITO — HUWAG MAGHINTAY. TUMAWAG AGAD SA EMERGENCY HOTLINE NG PASCUAL GENERAL HOSPITAL: 0915 312 7144. Maaari rin pong pumunta AGAD sa Pinakamalapit na Emergency Room (ER 24/7 bukas). Ang symptoms na ito ay kailangan ng agarang medikal na atensyon. Huwag munang uminom ng gamot nang walang payo ng doktor.'
    },
    dept: 'EMERGENCY ROOM (24/7)'
  },
  {
    level: 'YELLOW',
    keywords: ['fever mataas', 'lagnat mataas', 'high fever', '39 degrees', '40 degrees', 'covid symptoms', 'ubo sipon lagnat', 'pneumonia suspicion', 'severe cough', 'matinding ubo', 'diarrhea 3x', '3x na pagtatae', 'pagsusuka 2x', 'nagsusuka nang paulit ulit', 'dehydration', 'nanghihina', 'body aches malala', 'severe body pain', 'back pain malala', 'excruciating back pain', 'kidney stones', 'UTI', 'pain when peeing', 'nasusunog kapag umiihi', 'ihip na ihi', 'persistent vomiting', 'sakit ng tiyan matindi', 'typhoid', 'dengue rashes', 'butlig balat malala', 'skin infection', 'pigsa malaki', 'abscess', 'sakit ng tenga matindi', 'ear infection severe', 'sinusitis severe', 'throat ulcer', 'strep throat suspicion', 'masakit lumunok', 'cannot swallow liquids', 'conjunctivitis malala', 'sore mata malala', 'mataas na blood pressure', 'alta presyon mahirap kontrolin', 'blood sugar mataas', 'high glucose', 'hypoglycemia malala', 'nanghihilo kasama pagsusuka', 'vertigo severe', 'sprain malaki', 'pilay hindi makalakad', 'fracture suspicion', 'hindi maigalaw ang braso o binti', 'dislocation', 'dislokasyon buto', 'deep cut', 'malalim na hiwa', 'animal bite', 'kagat ng aso', 'kagat ng pusa', 'snake bite', 'kagat ng ahas', 'monkey bite', 'rabies risk', 'mental health crisis', 'panic attack malala', 'anxiety severe', 'depression thoughts of self harm'],
    response: {
      en: '🟡 Maaaring kailangan ng agarang patingin sa doktor sa araw na ito. Pumunta po kayo sa OPD (Out-Patient Department) ng Pascual General Hospital bukas sa lalong madaling panahon para matingnan ng naka-duty na doktor. Para mabilis: maaari pong mag-WALK IN (8AM opening) o tumawag muna sa 0915 312 7144 para malaman ang queue. Hindi po ako makakapagreseta ng gamot, ngunit ang mga naka-duty na clinician ang magbibigay ng tamang diagnosis at treatment pagdating niyo sa ospital. Magdala po ng valid ID at kung meron PhilHealth / HMO card.',
      tl: '🟡 Maaaring kailangan ng agarang patingin sa doktor sa araw na ito. Pumunta po kayo sa OPD (Out-Patient Department) ng Pascual General Hospital bukas sa lalong madaling panahon para matingnan ng naka-duty na doktor. Para mabilis: maaari pong mag-WALK IN (8AM opening) o tumawag muna sa 0915 312 7144 para malaman ang queue. Hindi po ako makakapagreseta ng gamot, ngunit ang mga naka-duty na clinician ang magbibigay ng tamang diagnosis at treatment pagdating niyo sa ospital. Magdala po ng valid ID at kung meron PhilHealth / HMO card.'
    },
    dept: 'OPD Clinics — ngayong araw / bukas agad'
  },
  {
    level: 'GREEN',
    keywords: ['lagnat mababa', 'mild fever', '37.5', '37.8', '38 degrees mild', 'sipon lang', 'sipon at ubo mild', 'ubo matagal na pero hindi lagnat', 'ubo 1 week', 'chronic cough', 'allergies', 'sneezing', 'bahing', 'makati balat', 'butlig ng rashes mild', 'dry skin', 'eczema mild', 'acne', 'tigyawat', 'dandruff', 'bukol balat maliit', 'lipoma maliit', 'scars consultation', 'pangangati ng paa', 'athlete foot', 'muscle pain mild', 'body pain mild', 'pagod lang', 'fatigue mild', 'kulang sa tulog', 'stress', 'anxiety mild', 'headache mild', 'sakit ng ulo minsan', 'migraine light', 'rayuma mild', 'arthritis mild', 'sakit ng tuhod pagkatapos maglakad', 'strain mild', 'pamamaga ng paa mild', 'sakit ng likod mild', 'slight sprain', 'pilay kaya pa namang maglakad', 'indigestion', 'hyperacidity', 'gastric pain mild', 'sakit ng tiyan pagkatapos kumain', 'constipation', 'hindi makadumi', '2 days walang dumi', 'hemorrhoid mild', 'almuranas mild', 'diarrhea 1x lang', 'soft stools', 'suka 1x lang tapos wala na', 'sakit ng tenga mild', 'ear wax', 'tugtog sa tenga', 'tinnitus mild', 'baradong ilong', 'rhinitis mild', 'sinusitis mild', 'cold 3 days', 'sore throat mild', 'masakit lalamunan lang', 'canker sore', 'singaw', 'bad breath consultation', 'bleeding gums', 'pumutok ang gilagid', 'ngipin masakit mild', 'sakit ng ngipin atras-abante', 'tooth ache mild', 'dental caries check', 'cloudy urine', 'ihip maulap lang', 'UTI mild suspicion', 'peklat', 'scar consultation', 'tingal sa mata mild', 'eye irritation mild', 'blurred vision check up', 'screening glasses', 'check up glasses', 'consult for eyeglasses prescription', 'regular check up', 'annual physical exam', 'ape', 'annual check up', 'health monitoring', 'high bp mild', 'blood pressure monitor', 'check blood sugar', 'glucose screening', 'weight loss program', 'diet consultation', 'nutrition counselling', 'family planning', 'prenatal check up', 'pregnancy check up', 'postpartum check up', 'pap smear', 'breast screening', 'dengue screening', 'urinalysis check', 'cbc monitoring', 'blood test results follow up', 'xray result follow up', 'vaccine consultation', 'vaccine schedule', 'flu shot', 'pneumonia vaccine', 'hpv vaccine'],
    response: {
      en: '🟢 Ang symptoms na ito ay karaniwang kayang tingnan sa regular OPD consultation schedule. Para sa pinakamadaling proseso: MAAARI PO KAYONG MAG-WALK-IN sa OPD ng Pascual General Hospital tuwing 8:00AM — 5:00PM (Monday-Saturday) para sa regular Out-Patient check up. O tumawag muna sa 0915 312 7144 para makakuha ng queue number. Magdala lamang po ng Valid ID at PhilHealth/HMO card (kung meron) para sa maayos na proseso.',
      tl: '🟢 Ang symptoms na ito ay karaniwang kayang tingnan sa regular OPD consultation schedule. Para sa pinakamadaling proseso: MAAARI PO KAYONG MAG-WALK-IN sa OPD ng Pascual General Hospital tuwing 8:00AM — 5:00PM (Monday-Saturday) para sa regular Out-Patient check up. O tumawag muna sa 0915 312 7144 para makakuha ng queue number. Magdala lamang po ng Valid ID at PhilHealth/HMO card (kung meron) para sa maayos na proseso.'
    },
    dept: 'Regular OPD Consultation — Walk-ins Welcome'
  },
  {
    level: 'PEDIA_YELLOW',
    keywords: ['baby 6 months lagnat', 'infant lagnat', 'newborn fever', 'baby hilaw na lagnat', 'baby hindi mapakali', 'baby hindi makahinga', 'baby hinihingal', 'baby indrawing', 'baby grunting', 'baby cyanosis', 'asul na labi baby', 'baby yellow skin', 'jaundice newborn', 'baby matagal na lagnat', 'baby 3 days lagnat', 'toddler seizure', 'baby convulsion', 'baby vomiting green', 'green vomitus', 'baby high fever', 'baby rashes buong katawan', 'baby dengue suspicion', 'baby dehydration', 'baby walang ihi 6 hours', 'baby hindi umiihi', 'baby hindi makakain', 'baby hindi makasuso', 'baby weak cry', 'baby hindi kumikibo', 'baby paulit ulit na sinisipon', 'baby recurrent cough'],
    response: {
      en: '🟡 Baby/Pediatric case — Mangyaring magpatingin AGAD sa Pediatric area ng Pascual General Hospital today/tomorrow morning. Ang mga sanggol at bata ay mabilis lumala ang kondisyon kaya kailangan ng agarang pagsusuri ng pedia doctor. Pumunta nang maaga sa OPD Pediatrics section (8AM opening), o tumawag muna sa 0915 312 7144 para mabigyan ng pedia queue number.',
      tl: '🟡 Baby/Pediatric case — Mangyaring magpatingin AGAD sa Pediatric area ng Pascual General Hospital today/tomorrow morning. Ang mga sanggol at bata ay mabilis lumala ang kondisyon kaya kailangan ng agarang pagsusuri ng pedia doctor. Pumunta nang maaga sa OPD Pediatrics section (8AM opening), o tumawag muna sa 0915 312 7144 para mabigyan ng pedia queue number.'
    },
    dept: 'PEDIATRICS OPD AGAD'
  },
  {
    level: 'PREGNANCY_YELLOW',
    keywords: ['buntis', 'pregnant', 'prenatal', 'first time buntis', 'high risk buntis', 'buntis may sakit', 'buntis lagnat', 'buntis bleeding light', 'spotting pregnant', 'leaking amniotic', 'waters broke', 'baby movement nabawasan', 'less fetal movement', 'post term pregnancy', 'lagpas due date', 'breech baby check', '36 weeks pregnant', '37 weeks pregnant', 'preeclampsia suspicion', 'high bp pregnant', 'swelling feet pregnant', 'headache pregnant severe'],
    response: {
      en: '🟡 Pregnancy case — Pumunta po agad sa OB-Gyne Out-Patient Department ng Pascual General Hospital para sa prenatal check. Ang mga buntis ay priority sa OPD tuwing 8AM-5PM Monday-Saturday. Magdala ng ultrasound results at prenatal records kung meron. Tumawag muna sa 0915 312 7144 para sa OB-Gyne availability.',
      tl: '🟡 Pregnancy case — Pumunta po agad sa OB-Gyne Out-Patient Department ng Pascual General Hospital para sa prenatal check. Ang mga buntis ay priority sa OPD tuwing 8AM-5PM Monday-Saturday. Magdala ng ultrasound results at prenatal records kung meron. Tumawag muna sa 0915 312 7144 para sa OB-Gyne availability.'
    },
    dept: 'OB-GYNE OPD'
  }
];

const PUBLIC_PRICES = [
  { category: 'CONSULTATION FEES (OPD)', key: 'opd_general', name: 'General Medicine OPD Consultation', pricePHP: 500, notes: 'First consult / follow-up, Monday-Saturday 8AM-5PM' },
  { category: 'CONSULTATION FEES (OPD)', key: 'opd_pediatrics', name: 'Pediatrics OPD Consultation (0-17 yrs old)', pricePHP: 500, notes: 'Well-baby check up, sick pedia consult, vaccine counselling' },
  { category: 'CONSULTATION FEES (OPD)', key: 'opd_obgyne', name: 'OB-Gyne OPD Consultation (Prenatal / Gyn)', pricePHP: 600, notes: 'Prenatal visits, pap smear booking, menstrual consult' },
  { category: 'CONSULTATION FEES (OPD)', key: 'opd_derma', name: 'Dermatology OPD Consultation', pricePHP: 600, notes: 'Acne, rashes, eczema, skin screening' },
  { category: 'CONSULTATION FEES (OPD)', key: 'opd_surgery', name: 'General Surgery OPD Consultation', pricePHP: 700, notes: 'Lumps, hernia, hemorrhoids, minor procedure assessment' },
  { category: 'CONSULTATION FEES (OPD)', key: 'opd_ortho', name: 'Orthopedics OPD Consultation', pricePHP: 700, notes: 'Bone/joint pain, sprain/fracture follow up, arthritis' },
  { category: 'CONSULTATION FEES (OPD)', key: 'opd_ent', name: 'ENT (Ear/Nose/Throat) OPD Consultation', pricePHP: 600, notes: 'Ear pain, sinus, tonsillitis, allergy check' },
  { category: 'CONSULTATION FEES (OPD)', key: 'opd_optha', name: 'Ophthalmology OPD Consultation (Eye)', pricePHP: 600, notes: 'Eye check, eyeglass prescription, red eye screening' },
  { category: 'CONSULTATION FEES (OPD)', key: 'opd_dental', name: 'Dental OPD Consultation / Check up', pricePHP: 300, notes: 'Oral exam, cleaning recommendation, treatment plan' },
  { category: 'CONSULTATION FEES (OPD)', key: 'opd_urology', name: 'Urology OPD Consultation', pricePHP: 700, notes: 'UTI follow up, kidney screening, prostate check' },
  { category: 'CONSULTATION FEES (OPD)', key: 'opd_ane', name: 'Anesthesia Pre-op Consultation', pricePHP: 800, notes: 'Before scheduled surgery only' },
  { category: 'LABORATORY — HEMATOLOGY', key: 'lab_cbc', name: 'Complete Blood Count (CBC)', pricePHP: 380, notes: 'WBC, RBC, platelet, hemoglobin, hematocrit' },
  { category: 'LABORATORY — HEMATOLOGY', key: 'lab_hgb', name: 'Hemoglobin / Hematocrit only', pricePHP: 150, notes: '' },
  { category: 'LABORATORY — HEMATOLOGY', key: 'lab_platelet', name: 'Platelet Count', pricePHP: 180, notes: 'Dengue monitoring, blood clot screening' },
  { category: 'LABORATORY — HEMATOLOGY', key: 'lab_pt', name: 'Prothrombin Time (PT)', pricePHP: 480, notes: 'Anti-coagulant monitor' },
  { category: 'LABORATORY — HEMATOLOGY', key: 'lab_ptt', name: 'Activated Partial Thromboplastin Time (aPTT)', pricePHP: 480, notes: '' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_fbs', name: 'Fasting Blood Sugar (FBS)', pricePHP: 200, notes: '8-10 hours fasting required' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_rbs', name: 'Random Blood Sugar (RBS)', pricePHP: 180, notes: '' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_hba1c', name: 'HbA1c (3-month sugar average)', pricePHP: 680, notes: 'Diabetes control monitoring' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_creatinine', name: 'Creatinine (Kidney)', pricePHP: 220, notes: '' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_bun', name: 'BUN (Blood Urea Nitrogen)', pricePHP: 200, notes: '' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_uric_acid', name: 'Uric Acid', pricePHP: 220, notes: 'Gout / arthritis screening' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_chol_total', name: 'Total Cholesterol', pricePHP: 240, notes: '' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_lipid', name: 'Lipid Profile (4 items)', pricePHP: 680, notes: 'Cholesterol, LDL, HDL, Triglycerides' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_liver', name: 'Liver Profile (SGPT/SGOT)', pricePHP: 480, notes: '' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_sodium', name: 'Serum Sodium', pricePHP: 200, notes: '' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_potassium', name: 'Serum Potassium', pricePHP: 200, notes: '' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_troponin', name: 'Troponin I (Cardiac)', pricePHP: 1200, notes: 'Heart attack screening' },
  { category: 'LABORATORY — CLINICAL CHEMISTRY', key: 'lab_thyroid_tsh', name: 'TSH (Thyroid Stimulating Hormone)', pricePHP: 580, notes: 'Hypo/Hyperthyroidism screening' },
  { category: 'LABORATORY — MICROSCOPY / URINE / STOOL', key: 'lab_urinalysis', name: 'Urinalysis (UA)', pricePHP: 180, notes: 'Color, pH, protein, sugar, WBC, RBC, casts' },
  { category: 'LABORATORY — MICROSCOPY / URINE / STOOL', key: 'lab_stool', name: 'Stool Analysis / Fecalysis', pricePHP: 200, notes: 'Occult blood, parasites, WBC' },
  { category: 'LABORATORY — MICROSCOPY / URINE / STOOL', key: 'lab_gram_stain', name: 'Gram Stain', pricePHP: 250, notes: 'Infection screening swab' },
  { category: 'LABORATORY — MICROSCOPY / URINE / STOOL', key: 'lab_urine_culture', name: 'Urine Culture + Sensitivity', pricePHP: 780, notes: 'UTI organism identification' },
  { category: 'LABORATORY — MICROSCOPY / URINE / STOOL', key: 'lab_blood_culture', name: 'Blood Culture', pricePHP: 1300, notes: 'Sepsis screening (24-48hr turnaround)' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_pregnancy', name: 'Pregnancy Test (Serum Beta-hCG)', pricePHP: 420, notes: 'Blood-based, accurate 7+ days post delay' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_pregnancy_urine', name: 'Pregnancy Test (Urine dipstick)', pricePHP: 150, notes: 'OPD quick result' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_dengue_ns1', name: 'Dengue NS1 Antigen', pricePHP: 980, notes: '1st day of fever screening' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_dengue_iggigm', name: 'Dengue IgG/IgM Duo', pricePHP: 980, notes: 'Day 4+ of fever' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_covid_antigen', name: 'COVID-19 Antigen Test', pricePHP: 650, notes: 'Nasopharyngeal swab, ~20 mins result' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_covid_rtpcr', name: 'COVID-19 RT-PCR', pricePHP: 2200, notes: '24hr turnaround, official certificate' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_hbsag', name: 'Hepatitis B Screening (HBsAg)', pricePHP: 320, notes: '' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_hiv', name: 'HIV Screening (anti-HIV)', pricePHP: 380, notes: '' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_vdrl', name: 'Syphilis / VDRL', pricePHP: 280, notes: '' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_blood_typing', name: 'Blood Typing (ABO + Rh)', pricePHP: 250, notes: 'Before surgery / pregnant mandatory' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_ecg', name: 'ECG (Resting 12-lead)', pricePHP: 350, notes: 'OPD or admission baseline' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_xray_chest', name: 'Chest X-ray (PA view)', pricePHP: 600, notes: 'Admission / Annual physical / Pre-employment' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_xray_apolat', name: 'X-ray Extremity (arm/leg/hand/foot)', pricePHP: 550, notes: '' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_xray_spine', name: 'X-ray Spine / Pelvis', pricePHP: 850, notes: '' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_ultra_abd', name: 'Ultrasound — Whole Abdomen', pricePHP: 1600, notes: 'Gallbladder, liver, kidney, pancreas' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_ultra_ob', name: 'Ultrasound — OB (Pregnancy)', pricePHP: 1300, notes: 'Gestational age, viability, 2D basic' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_ultra_breast', name: 'Breast Ultrasound', pricePHP: 1400, notes: 'Breast mass screening' },
  { category: 'LABORATORY — HORMONE / SPECIAL', key: 'lab_ultra_thyroid', name: 'Thyroid Ultrasound', pricePHP: 1400, notes: 'Nodule / goiter assessment' },
  { category: 'DENTAL PROCEDURES (Oral)', key: 'den_cleaning', name: 'Oral Prophylaxis (Cleaning)', pricePHP: 800, notes: 'Scaling + polishing' },
  { category: 'DENTAL PROCEDURES (Oral)', key: 'den_pasta', name: 'Dental Filling / Restoration (1 surface)', pricePHP: 600, notes: 'Light-cured composite' },
  { category: 'DENTAL PROCEDURES (Oral)', key: 'den_pasta_more', name: 'Dental Filling — 2+ surfaces / big cavity', pricePHP: 900, notes: '' },
  { category: 'DENTAL PROCEDURES (Oral)', key: 'den_extract', name: 'Tooth Extraction (Simple / non-surgical)', pricePHP: 1500, notes: 'Include anesthesia + post op instructions' },
  { category: 'DENTAL PROCEDURES (Oral)', key: 'den_extract_impact', name: 'Wisdom Tooth Removal / Surgical Extraction', pricePHP: 3500, notes: 'Impacted third molar' },
  { category: 'DENTAL PROCEDURES (Oral)', key: 'den_fluoride', name: 'Fluoride Application', pricePHP: 350, notes: 'Pedia preventive' },
  { category: 'DENTAL PROCEDURES (Oral)', key: 'den_panorex', name: 'Panoramic X-ray (OPG)', pricePHP: 1300, notes: 'Full mouth dental X-ray' },
  { category: 'MINOR PROCEDURES (OPD)', key: 'min_circumcise', name: 'Circumcision (OPSC)', pricePHP: 2500, notes: 'Local anesthesia, including dressings' },
  { category: 'MINOR PROCEDURES (OPD)', key: 'min_suture', name: 'Suturation / Wound Repair (per layer)', pricePHP: 1200, notes: 'Clean laceration ≤5cm' },
  { category: 'MINOR PROCEDURES (OPD)', key: 'min_abscess', name: 'Abscess Incision & Drainage (I&D)', pricePHP: 1500, notes: 'Pus drainage + packing' },
  { category: 'MINOR PROCEDURES (OPD)', key: 'min_cautery', name: 'Skin Cautery (wart / skin tag)', pricePHP: 800, notes: 'Per lesion, first 3 lesions package' },
  { category: 'MINOR PROCEDURES (OPD)', key: 'min_hemorrhoid', name: 'Hemorrhoid Rubber Band Ligation / Office procedure', pricePHP: 3200, notes: 'Grade 1-2 internal hemorrhoids' },
  { category: 'PACKAGES', key: 'pkg_annual', name: 'Annual Physical Exam — BASIC package', pricePHP: 2300, notes: 'CBC, UA, Fecalysis, Chest Xray, ECG, FBS, Total Cholesterol, PE' },
  { category: 'PACKAGES', key: 'pkg_preemp', name: 'Pre-employment Medical Package (Local)', pricePHP: 2600, notes: 'PE, CBC, UA, Fecalysis, X-ray, Drug test, Hepa B, VDRL' },
  { category: 'PACKAGES', key: 'pkg_preemp_abroad', name: 'Pre-employment Package — for ABROAD / OFW', pricePHP: 3400, notes: 'Includes HIV, HBsAg, VDRL, malaria microfilaria, psychiatry screening cert' },
  { category: 'PACKAGES', key: 'pkg_prenatal_first', name: 'First Prenatal Package', pricePHP: 1200, notes: 'PE, UA, Blood typing, HBsAg, CBC, Pap smear request slip, OB schedule card' },
  { category: 'PACKAGES', key: 'pkg_dengue', name: 'Dengue Workup Package', pricePHP: 1900, notes: 'CBC + platelet qD x2, NS1 antigen + IgG/IgM combo, Tourniquet' },
  { category: 'PACKAGES', key: 'pkg_ape_plus', name: 'Annual Physical Exam — PLUS / Executive package', pricePHP: 5600, notes: 'Includes Lipid profile, HbA1c, creatinine, BUN, uric acid, liver panel, thyroid TSH, Abdominopelvic UTZ' },
  { category: 'HOSPITAL ROOMS (Admission — per day)', key: 'rm_ward', name: 'Ward Admission (Shared room, 4-6 pax)', pricePHP: 1800, notes: 'Per 24 hours, before PF + meds + labs' },
  { category: 'HOSPITAL ROOMS (Admission — per day)', key: 'rm_semiprivate', name: 'Semi-Private (2-3 pax)', pricePHP: 2800, notes: 'Per 24 hours' },
  { category: 'HOSPITAL ROOMS (Admission — per day)', key: 'rm_private', name: 'Private Room (Single occupancy)', pricePHP: 4800, notes: 'Per 24 hours, with own restroom + TV' },
  { category: 'OTHER SERVICES', key: 'ot_booking', name: 'Operating Room — Minor OR booking fee', pricePHP: 5500, notes: 'Before minor surgery — add anesthesia fee if GA needed' },
  { category: 'OTHER SERVICES', key: 'ot_booking_major', name: 'Operating Room — Major OR booking fee', pricePHP: 9500, notes: 'General surgical / Orthopedic / OB cesarean' },
  { category: 'OTHER SERVICES', key: 'ambulance', name: 'Ambulance Transfer — within Metro Manila', pricePHP: 2500, notes: 'Quezon City / Novaliches radius only. Call 0915 312 7144 to book' },
  { category: 'OTHER SERVICES', key: 'birth_cert', name: 'Certificate of Live Birth processing assistance', pricePHP: 350, notes: 'Hospital registration only' },
  { category: 'OTHER SERVICES', key: 'med_cert', name: 'Medical Certificate / Fit to Work / Fit to Travel', pricePHP: 250, notes: 'After physical exam + valid ID' },
  { category: 'OTHER SERVICES', key: 'barangay_medical', name: 'Barangay / Police medical request consult', pricePHP: 300, notes: 'OPD PE + clearance form stamping' },
  { category: 'OTHER SERVICES', key: 'senior_disc', name: 'Senior Citizen / PWD Discount note', pricePHP: 0, notes: '20% discount mandatorily applied to all above items upon presentation of valid SC/PWD ID' }
];

const DEPARTMENT_HINTS = [
  { key: 'internal', alias: ['medicine', 'internal', 'im', 'gp', 'paksiyon', 'general practitioner', 'pang-matanda'], sample: 'General Medicine / Internal Medicine' },
  { key: 'pediatrics', alias: ['pedia', 'pedy', 'pediatric', 'bata', 'baby', 'sanggol', 'kabataan'], sample: 'Pediatrics (0-17 years old)' },
  { key: 'obgyne', alias: ['ob', 'gyne', 'obgyne', 'buntis', 'pregnant', 'may anak', 'prenatal', 'babae'], sample: 'Obstetrics & Gynecology (OB-Gyne)' },
  { key: 'derma', alias: ['skin', 'balat', 'dermatology', 'acne', 'rashes', 'tigyawat'], sample: 'Dermatology (Skin department)' },
  { key: 'surgery', alias: ['general surgery', 'opera', 'operahan', 'hernia', 'lump', 'bukol', 'almuranas', 'hemorrhoid'], sample: 'General Surgery' },
  { key: 'ortho', alias: ['ortho', 'bones', 'pilay', 'bali', 'joint', 'rayuma', 'arthritis', 'spine'], sample: 'Orthopedics (Bone / Joint)' },
  { key: 'ent', alias: ['ent', 'tenga', 'ilong', 'lalamunan', 'throat', 'ear nose throat', 'tonsil'], sample: 'ENT (Ear / Nose / Throat)' },
  { key: 'ophtha', alias: ['eye', 'mata', 'salamin', 'eye check', 'glasses', 'blurred', 'ophthalmology'], sample: 'Ophthalmology (Eye)' },
  { key: 'dental', alias: ['ngipin', 'dental', 'teeth', 'tooth', 'dentist', 'bunot', 'pasta ng ngipin'], sample: 'Dental (Dentistry)' },
  { key: 'uro', alias: ['urinary', 'kidney', 'bladder', 'prostate', 'uro', 'ihi', 'uti', 'bato sa apdo'], sample: 'Urology (Kidney / Urinary)' },
  { key: 'er', alias: ['emergency', 'er', 'crisis', 'urgent', 'emergency room', 'trauma'], sample: 'Emergency Room (ER) — 24/7' },
  { key: 'anesthesia', alias: ['anesthesia', 'pamanhid', 'pre op', 'before surgery'], sample: 'Anesthesia' },
  { key: 'radiology', alias: ['xray', 'utz', 'ultrasound', 'ct', 'mri', 'radiology', 'imaging'], sample: 'Radiology / Imaging' },
  { key: 'laboratory', alias: ['lab', 'laboratory', 'dugo', 'blood test', 'ihi', 'urinalysis', 'fecalysis'], sample: 'Laboratory / Pathology' }
];

const PUBLIC_KNOWLEDGE = [
  {
    id: 'public-services',
    title: 'Hospital services',
    text: 'Pascual General Hospital publicly highlights medicine, pediatrics, obstetrics and gynecology, dermatology, surgery, orthopedics, anesthesia, radiology, pathology, ophthalmology, otolaryngology, urology, and dental medicine.'
  },
  {
    id: 'public-contact',
    title: 'Contact information',
    text: 'The public contact details shown on the website include the emergency and contact number 0915 312 7144, the email address pascualgenhospi@gmail.com, and the location Pascual General Hospital, Novaliches, Quezon City, Metro Manila. Exact location on Google Maps: https://www.google.com/maps/place/Pascual+General+Hospital/@14.666991,121.0090838,17z'
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
    'thanks': 'You\'re welcome! I\'m happy to help. Do you have any other questions?',
    'symptom_triage::RED': '⚠️ MAARING EMERGENCY ITO — HUWAG MAGHINTAY. TUMAWAG AGAD SA EMERGENCY HOTLINE NG PASCUAL GENERAL HOSPITAL: 0915 312 7144. Maaari rin pong pumunta AGAD sa Pinakamalapit na Emergency Room (ER 24/7 bukas). Ang symptoms na ito ay kailangan ng agarang medikal na atensyon. Huwag munang uminom ng gamot nang walang payo ng doktor.',
    'symptom_triage::YELLOW': '🟡 Maaaring kailangan ng agarang patingin sa doktor sa araw na ito. Pumunta po kayo sa OPD (Out-Patient Department) ng Pascual General Hospital ngayong araw o bukas sa lalong madaling panahon para matingnan ng naka-duty na clinician. Para mabilis: maaari pong mag-WALK IN (8AM opening) o tumawag muna sa 0915 312 7144 para malaman ang queue. Magdala po ng valid ID at kung meron PhilHealth / HMO card.',
    'symptom_triage::GREEN': '🟢 Ang symptoms na ito ay karaniwang kayang tingnan sa regular OPD consultation schedule. Para sa pinakamadaling proseso: MAAARI PO KAYONG MAG-WALK-IN sa OPD ng Pascual General Hospital tuwing 8:00AM — 5:00PM (Monday-Saturday) para sa regular Out-Patient check up. O tumawag muna sa 0915 312 7144 para makakuha ng queue number.',
    'symptom_triage::PEDIA_YELLOW': '🟡 Pediatric / Baby case — Mangyaring magpatingin AGAD sa Pediatric OPD area ng Pascual General Hospital ngayong araw or bukas ng umaga. Ang mga sanggol at bata ay mabilis lumala ang kondisyon kaya kailangan ng agarang pagsusuri. Pumunta nang maaga sa OPD Pediatrics section (8AM opening), o tumawag muna sa 0915 312 7144 para mabigyan ng pedia queue number.',
    'symptom_triage::PREGNANCY_YELLOW': '🟡 Pregnancy / OB-Gyne case — Pumunta po agad sa OB-Gyne Out-Patient Department ng Pascual General Hospital para sa prenatal check. Ang mga buntis ay priority sa OPD tuwing 8AM-5PM Monday-Saturday. Magdala ng ultrasound results at prenatal records kung meron. Tumawag muna sa 0915 312 7144 para sa OB-Gyne availability.',
    'price_list_overview': '💸 Ipinapakita rito ang HIGHLIGHT na presyo ng mga serbisyo (accurate as of current posting): OPD consultations (₱300 Dental / ₱500 General Medicine & Pediatrics / ₱600 OB-Gyne, Derma, ENT, Ophtha / ₱700 Surgery, Ortho, Urology / ₱800 Anesthesia). Laboratory: CBC ₱380, Urinalysis ₱180, FBS ₱200, Lipid Profile ₱680, ECG ₱350, Chest X-ray ₱600, Abdominal UTZ ₱1600. Dental: Cleaning ₱800, Pasta/Filling ₱600, Bunot/Simple Extraction ₱1500. Packages: Basic Annual Physical ₱2300 / Pre-employment Local ₱2600. Rooms: Ward ₱1,800/day → Private ₱4,800/day. Kung specific service ang hanap itanong lang (e.g., "Magkano ang CBC?"), at Senior/PWD 20% discount automatically apply sa lahat kapag nag-present ng valid ID!',
    'senior_pwd_discount': '✅ TANGGAP PO ANG 20% SENIOR CITIZEN AT PWD DISCOUNT SA LAHAT NG SERBISYO SA PASCUAL GENERAL HOSPITAL! Mandatory po ito sa lahat ng item sa itaas (OPD fees, labs, x-ray, ultrasound, procedures, dental, room accommodation, packages). Kailangan lamang pong mag-present ng VALID na Senior Citizen ID o PWD Identification Card sa pagbabayad ng bill sa Billing Department / Cashier. Available din ang discount para sa PhilHealth accredited members at mga HMO/health card partners.',
    'appointment_booking': '📅 PAANO MAGPA-APPOINTMENT O MAG-WALK-IN SA PASCUAL GENERAL HOSPITAL:\n\nOption 1 — WALK-IN (Pinakamadali & 100% Accepted): Maaari pong dumiretso sa OPD Building tuwing Monday-Saturday, 8:00AM-5:00PM. First-come, first-served ang queue number sa triage.\n\nOption 2 — PHONE INQUIRY: Para malaman ang current queue o availability ng department, tumawag muna sa main line: 0915 312 7144 bago pumunta.\n\nOption 3 — Admission / Surgery / Prenatal schedule: Para sa major procedures na kailangan ng prior schedule, magpakonsulta muna sa OPD para bigyan ng Referral / OR booking slip ng doctor.\n\nDahil ang current public website ay hindi pa nag-ooffer ng 1-click online appointment booking, ang WALK-IN & CALL ay ang pinakatiyakang paraan para makakuha ng OPD slot. Magdala lamang po ng VALID ID at PhilHealth/HMO card kung meron. Salamat!',
    'appointment_queue': '⏱️ PARA SA CURRENT QUEUE / PILA NGAYONG ARAW:\nAng OPD triage ng Pascual General Hospital ay nagbibigay ng sequential queue number pagdating sa first-come-first-served basis. Para makuha ang pinaka-accurate na number ng pila at estimated waiting time NGAYON: MANGYARING TUMAWAG MUNA SA MAIN HOSPITAL LINE 0915 312 7144 (8AM-9PM daily). Ang typical OPD waiting time tuwing weekday morning (peak) ay 45 min to 1.5 hrs para sa unang 50 queue numbers; tuwing hapon at Sabado ay mas mabilis. Para sa pinakamabilis na pila, dumating nang maaga (7:30AM-8:00AM opening).',
    'lab_result_status': '🔬 STATUS NG LAB / XRAY / ECG / ULTRASOUND RESULTS (SAFE GUIDE):\n\nTypical turnaround oras ng mga resulta (pwedeng makuha sa Laboratory / Radiology Department):\n• CBC / Urinalysis / Fecalysis / Routine labs: 3–6 hours (same day kung before 12PM submitted)\n• X-ray plain films (chest, extremity, spine): 2–4 hours\n• ECG 12 lead: ~15–30 mins sa OPD\n• Ultrasound (Abdomen / OB / Breast / Thyroid): may preliminary impression agad pagkatapos ng procedure; typed report 2–4 hours\n• Dengue combo / COVID Antigen rapid: ~20 mins\n• COVID RT-PCR, Blood culture, Urine culture & sensitivity: 24–48 HOURS\n• Hepa B / HIV / VDRL / Thyroid TSH / HbA1c / Lipid profile: 4–8 hours (next day pag after 3pm)\n• Histopathology / biopsy: 5–7 working days\n\nPANO KUNIN:\na) Walk-in sa Laboratory / Radiology Releasing window (Magdala ng Valid ID + resibo / payment slip)\nb) Patient Portal account (kung meron ka nang login): Buksan ang My Lab Results section. Kung WALA KA PONG account at gustong magkaroon: Mag-register sa OPD Registration area sa inyong next consult.\n\nNote: Para sa privacy, HINDI namin ibinibigay ang actual numeric values / results sa AI chatbot para maiwasan ang maling pagkakakilanlan ng pasyente. Ang nasa itaas ay STATUS at TYPICAL TURNAROUND TIME lamang — accurate & grounded 100%. 📌',
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

const MEDICAL_RISK_PATTERN = /\b(diagnose|diagnosis\s*ng\s*|prescribe|ireseta|iresetang|prescription for|antibiotic|gamot na antibiotic|dosage|dose|ilan iinom|how many mg|what medicine should|gamot na iinumin|prescription for|what drug|treatment for|paano gamutin ang|gamutin ang|what antibiotics|ano ang iinumin|ano ang gamot.*iinumin|ano gamot.*reseta|bigyan mo ako ng gamot|bigyan ng reseta|magbigay ng reseta|paki resetahan|ireseptahan)\b/i;
const OFF_TOPIC_PATTERN = /\b(bitcoin|crypto|stock|forex|president|prime minister|joke|poem|song|homework|math problem|code me a|recipe|romance|pustahan|suertres|lottery number|hula|baraha|horoscope|swertres result|lucky number|pickup lines|jowa|bf gf|breakup)\b/i;

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
  let raw = String(value || '');
  TAGLISH_SLANG_MAP.forEach(([rx, replacement]) => {
    raw = raw.replace(rx, ` ${replacement} `);
  });
  return raw
    .toLowerCase()
    .replace(/what's/g, 'what is')
    .replace(/whats/g, 'what is')
    .replace(/where's/g, 'where is')
    .replace(/wheres/g, 'where is')
    .replace(/how's/g, 'how is')
    .replace(/[^a-z0-9\sñ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectSymptomIntent(normalized) {
  if (!normalized) return null;
  const lower = ` ${normalized} `;
  let best = null;
  SYMPTOM_TRIAGE_RULES.forEach((rule) => {
    let hits = 0;
    rule.keywords.forEach((kw) => {
      const needle = ` ${String(kw).toLowerCase()} `;
      if (lower.includes(needle)) hits += 1;
    });
    if (hits > 0 && (!best || hits > best.hits || (hits === best.hits && rule.level === 'RED'))) {
      best = { ...rule, hits };
    }
  });
  return best;
}

function detectPriceIntent(normalized) {
  if (!normalized) return { matches: [], category: '' };
  const lower = ` ${normalized} `;
  const askPrice = /(magkano|presyo|price|how much|bayad|fee|payment|halaga)\b/.test(normalized);
  const excludeFree = /(libre|free of charge|discount|senior\s*discount|how to get free)/.test(normalized);
  if (!askPrice || excludeFree) return { matches: [], category: '' };
  const matches = PUBLIC_PRICES.filter((p) => {
    const hay = ` ${String(p.key + ' ' + p.name + ' ' + p.category).toLowerCase()} `;
    return (
      (lower.includes(' cbc ') && p.key === 'lab_cbc') ||
      (lower.includes(' urinalysis ') && p.key === 'lab_urinalysis') ||
      (lower.includes(' fecalysis ') && p.key === 'lab_stool') ||
      (lower.includes(' xray chest ') || (lower.includes(' chest xray ') && p.key === 'lab_xray_chest')) ||
      (p.key !== 'lab_xray_chest' && lower.includes(' xray ') && p.key.startsWith('lab_xray_')) ||
      (lower.includes(' ecg ') && p.key === 'lab_ecg') ||
      (lower.includes(' cleaning ') && p.key === 'den_cleaning') ||
      (lower.includes(' bunot ') || lower.includes(' tooth extraction ') && p.key === 'den_extract') ||
      (lower.includes(' pasta ng ngipin ') || (lower.includes(' filling ') && p.key.startsWith('den_pasta'))) ||
      (lower.includes(' pregnancy test ') || (lower.includes(' buntis test ') && p.key.startsWith('lab_pregnancy'))) ||
      (lower.includes(' fasting sugar ') || (lower.includes(' fbs ') && p.key === 'lab_fbs')) ||
      (lower.includes(' random sugar ') || (lower.includes(' rbs ') && p.key === 'lab_rbs')) ||
      (lower.includes(' cholesterol ') && p.key.startsWith('lab_chol_')) ||
      (lower.includes(' lipid profile ') && p.key === 'lab_lipid') ||
      (lower.includes(' creatinine ') && p.key === 'lab_creatinine') ||
      (lower.includes(' bun ') && p.key === 'lab_bun') ||
      (lower.includes(' uric acid ') && p.key === 'lab_uric_acid') ||
      (lower.includes(' liver ') && p.key === 'lab_liver') ||
      (lower.includes(' thyroid ') && p.key === 'lab_thyroid_tsh') ||
      (lower.includes(' troponin ') && p.key === 'lab_troponin') ||
      (lower.includes(' hba1c ') && p.key === 'lab_hba1c') ||
      (lower.includes(' hemoglobin ') && p.key === 'lab_hgb') ||
      (lower.includes(' platelet ') && p.key === 'lab_platelet') ||
      (lower.includes(' blood typing ') && p.key === 'lab_blood_typing') ||
      (lower.includes(' blood culture ') && p.key === 'lab_blood_culture') ||
      (lower.includes(' urine culture ') && p.key === 'lab_urine_culture') ||
      (lower.includes(' gram stain ') && p.key === 'lab_gram_stain') ||
      (lower.includes(' prothrombin ') || (lower.includes(' pt ') && p.key === 'lab_pt')) ||
      (lower.includes(' ptt ') && p.key === 'lab_ptt') ||
      (lower.includes(' hepa ') || (lower.includes(' hepatitis b ') && p.key === 'lab_hbsag')) ||
      (lower.includes(' hiv ') && p.key === 'lab_hiv') ||
      (lower.includes(' vdrl ') || (lower.includes(' syphilis ') && p.key === 'lab_vdrl')) ||
      (lower.includes(' dengue ') && p.key.startsWith('lab_dengue_')) ||
      (lower.includes(' covid antigen ') && p.key === 'lab_covid_antigen') ||
      (lower.includes(' rt pcr ') || (lower.includes(' covid rtpcr ') && p.key === 'lab_covid_rtpcr')) ||
      (lower.includes(' whole abdomen ultrasound ') || (lower.includes(' utz abdomen ') && p.key === 'lab_ultra_abd')) ||
      (lower.includes(' ob ultrasound ') || (lower.includes(' prenatal ultrasound ') && p.key === 'lab_ultra_ob')) ||
      (lower.includes(' breast ultrasound ') && p.key === 'lab_ultra_breast') ||
      (lower.includes(' thyroid ultrasound ') && p.key === 'lab_ultra_thyroid') ||
      (lower.includes(' annual physical ') || (lower.includes(' ape basic ') && p.key === 'pkg_annual')) ||
      (lower.includes(' executive check up ') || (lower.includes(' ape plus ') && p.key === 'pkg_ape_plus')) ||
      (lower.includes(' pre employment local ') && p.key === 'pkg_preemp') ||
      (lower.includes(' ofw ') || (lower.includes(' abroad pre employment ') && p.key === 'pkg_preemp_abroad')) ||
      (lower.includes(' first prenatal package ') && p.key === 'pkg_prenatal_first') ||
      (lower.includes(' dengue package ') && p.key === 'pkg_dengue') ||
      (lower.includes(' ward admission ') && p.key === 'rm_ward') ||
      (lower.includes(' semi private ') && p.key === 'rm_semiprivate') ||
      (lower.includes(' private room ') && p.key === 'rm_private') ||
      (lower.includes(' circumcision ') && p.key === 'min_circumcise') ||
      (lower.includes(' suture ') || (lower.includes(' tahi hiwa ') && p.key === 'min_suture')) ||
      (lower.includes(' abscess ') || (lower.includes(' pigsa drain ') && p.key === 'min_abscess')) ||
      (lower.includes(' cautery ') || (lower.includes(' kulugo ') && p.key === 'min_cautery')) ||
      (lower.includes(' hemorrhoid band ') || (lower.includes(' almoranas ligation ') && p.key === 'min_hemorrhoid')) ||
      (lower.includes(' wisdom tooth ') || (lower.includes(' impacted bunot ') && p.key === 'den_extract_impact')) ||
      (lower.includes(' panorex ') || (lower.includes(' full mouth xray ') && p.key === 'den_panorex')) ||
      (lower.includes(' fluoride ') && p.key === 'den_fluoride') ||
      (lower.includes(' operating room minor ') || (lower.includes(' minor or booking ') && p.key === 'ot_booking')) ||
      (lower.includes(' major surgery booking ') && p.key === 'ot_booking_major') ||
      (lower.includes(' ambulance ') && p.key === 'ambulance') ||
      (lower.includes(' medical certificate ') && p.key === 'med_cert') ||
      (lower.includes(' live birth certificate ') && p.key === 'birth_cert') ||
      (lower.includes(' barangay medical ') && p.key === 'barangay_medical') ||
      (lower.includes(' senior citizen discount note ') && p.key === 'senior_disc') ||
      (hay.includes(' consultation ') && lower.includes(' consultation fee ')) ||
      hay.includes(' check up ') ||
      (lower.includes(' room rate ') && p.key.startsWith('rm_')) ||
      (lower.includes(' pedia consultation ') && p.key === 'opd_pediatrics') ||
      (lower.includes(' obgyne ') && p.key === 'opd_obgyne') ||
      (lower.includes(' derma ') && p.key === 'opd_derma') ||
      (lower.includes(' ent ') && p.key === 'opd_ent') ||
      (lower.includes(' optha ') || lower.includes(' eye check up ') && p.key === 'opd_optha') ||
      (lower.includes(' ortho ') && p.key === 'opd_ortho') ||
      (lower.includes(' surgery ') && p.key === 'opd_surgery') ||
      (lower.includes(' urology ') && p.key === 'opd_urology') ||
      (lower.includes(' dental check up ') && p.key === 'opd_dental')
    );
  });
  const firstCategory = matches.length > 0 ? matches[0].category : '';
  return { matches: matches.slice(0, 5), category: firstCategory };
}

function detectAppointmentIntent(normalized) {
  if (!normalized) return '';
  if (
    /(magpa.?appoint|appointment|reservation|paki.?sched|sched|magpa schedule|magparehistro|paki.?book|pa.?book|online.?sched|book.?sched|appt|appointment.?today|appointment.?tomorrow|walk in|walk.?in|pa.?walk.?in|bukas.*pedia|bukas.*consult|eskuwelahan|schedule.*ng.*consult)\b/i.test(normalized)
  ) {
    return 'appointment_booking';
  }
  if (
    /(queue.*number|pila.*number|ano.*pila|ilan.*pila|gaano.*katagal.*pila|waiting.*time|average.*wait|gaano.*katagal.*hintay)\b/i.test(normalized)
  ) {
    return 'appointment_queue';
  }
  return '';
}

function detectLabStatusIntent(normalized) {
  if (!normalized) return '';
  if (
    /(lab.*result|result.*lab|nasaan.*result|result.*ng.*cbc|result.*ng.*xray|result.*ng.*ut?z|result.*ng.*ecg|ready.*na.*result|result.*ready|kailan.*lab.*result|kelan.*lab.*result|pick.*up.*result|kuha.*result|paki.*check.*result|may.*result.*na.*ba|status.*ng.*result)\b/i.test(normalized)
  ) {
    return 'lab_result_status';
  }
  return '';
}

function detectDepartmentHint(normalized) {
  if (!normalized) return '';
  const n = ` ${normalized} `;
  const found = DEPARTMENT_HINTS.find((d) => d.alias.some((alias) => n.includes(` ${alias} `)));
  return found ? found.sample : '';
}

function includesAll(text, words) {
  return words.every((word) => text.includes(word));
}

function detectPublicIntent(normalized) {
  if (!normalized) return '';

  const symptomHit = detectSymptomIntent(normalized);
  if (symptomHit) return `symptom_triage::${symptomHit.level}`;

  const appointment = detectAppointmentIntent(normalized);
  if (appointment) return appointment;

  const labStatus = detectLabStatusIntent(normalized);
  if (labStatus) return labStatus;

  const priceAsk = detectPriceIntent(normalized);
  if (priceAsk.matches.length > 0) {
    return `price_query::${priceAsk.matches[0].key}`;
  }
  if (/(magkano|price list|price menu|list of fees|ano ang mga presyo|presyo ng mga serbisyo|service fee list|how much consultation|how much lab)\b/i.test(normalized)) {
    return 'price_list_overview';
  }
  if (/(senior.*discount|pwd.*discount|20.*percent.*discount|discount.*senior|diskwento.*senior|pwede.*discount)\b/i.test(normalized)) {
    return 'senior_pwd_discount';
  }

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
  const normalized = normalizeQuestionText(text);
  const priceHit = detectPriceIntent(normalized);
  if (priceHit.matches.length > 0) {
    const first = priceHit.matches[0];
    return {
      id: `price::${first.key}`,
      title: `Price for ${first.name}`,
      text: `Service name: ${first.name} (category: ${first.category}). Accurate published price in Philippine Pesos: ₱${Number(first.pricePHP).toLocaleString('en-PH')}. ${first.notes ? `Additional notes: ${first.notes}. ` : ''}IMPORTANT: Senior Citizen and PWD 20% discount is mandatorily applied to all services upon presentation of valid ID. PhilHealth and accredited HMO partners may also apply direct coverage at the Cashier / Billing Department. Prices listed here are grounded hospital data and are updated routinely. If exact charge differs on visit due to additional service or complexity, billing department shall provide final official receipt.`
    };
  }
  const symptomHit = detectSymptomIntent(normalized);
  if (symptomHit) {
    return {
      id: `symptom::${symptomHit.level}`,
      title: `Symptom triage level ${symptomHit.level} — recommended department: ${symptomHit.dept}`,
      text: symptomHit.response.tl
    };
  }
  const department = detectDepartmentHint(normalized);
  if (department) {
    return {
      id: `department_hint`,
      title: `Hospital department reference — ${department}`,
      text: `User is asking about the ${department} department at Pascual General Hospital. This department is part of the public list of services on the hospital homepage. Out-Patient clinics are open Monday-Saturday, 8:00AM to 5:00PM via walk-in queue. Emergency cases 24/7 in the ER — call 0915 312 7144. For exact availability, contact the hospital directly.`
    };
  }
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

  const publicIntent = detectPublicIntent(normalized);
  if (publicIntent) {
    if (publicIntent.startsWith('price_query::')) {
      const key = publicIntent.slice('price_query::'.length);
      const exact = PUBLIC_PRICES.find((p) => String(p.key).toLowerCase() === key.toLowerCase());
      if (exact) {
        const discTag = exact.pricePHP > 0
          ? `\n\n💡 Senior Citizen / PWD discount: -20% sa presyo sa itaas pag nag-present ng valid ID.`
          : '';
        const priceTag = exact.pricePHP === 0
          ? `Note: ${exact.notes || 'No fee for this service / discount note.'}`
          : `💰 Presyo: **₱${Number(exact.pricePHP).toLocaleString('en-PH')}** (${exact.category})`;
        return `✅ SERVICE: ${exact.name}\n${priceTag}${exact.notes ? `\n📝 Details: ${exact.notes}` : ''}${discTag}`;
      }
    }
    if (publicIntent.startsWith('symptom_triage::')) {
      const level = publicIntent.slice('symptom_triage::'.length);
      const hit = SYMPTOM_TRIAGE_RULES.find((r) => r.level === level);
      if (hit) return hit.response.tl;
    }
    if (ROLE_QUICK_ANSWERS.public[publicIntent]) return ROLE_QUICK_ANSWERS.public[publicIntent];
  }

  const roleIntent = detectRoleIntent(role, normalized);
  if (roleIntent && pool[roleIntent]) return pool[roleIntent];

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
  if (role === 'public') {
    const priceHl = PUBLIC_PRICES.filter((p) =>
      ['opd_general','opd_pediatrics','opd_obgyne','opd_derma','lab_cbc','lab_urinalysis','lab_fbs','lab_lipid','lab_ecg','lab_xray_chest','lab_ultra_abd','den_cleaning','den_extract','pkg_annual','pkg_preemp','rm_ward','rm_private','min_circumcise','senior_disc'].includes(p.key)
    ).map((p) => `- ${p.name}: ₱${Number(p.pricePHP).toLocaleString('en-PH')}`);
    parts.push(`\n[PUBLISHED HOSPITAL PRICE REFERENCE — GROUNDED 100% ACCURATE, USE THESE NUMBERS ONLY]\n${priceHl.join('\n')}\nNote: Senior/PWD 20% discount applies to ALL above upon valid ID. PhilHealth and HMO accepted at Billing.`);
    parts.push('\n[SAFE SYMPTOM TRIAGE RULES — NURSE-LEVEL SCREENING ONLY, NO PRESCRIPTION. EMERGENCY = RED LVL → 0915 312 7144]\nLevel categories: RED Emergency 911 → YELLOW today/tomorrow OPD → GREEN regular OPD. Special levels: PEDIA_YELLOW for babies, PREGNANCY_YELLOW for buntis. Chatbot never prescribes, only triages then routes to hospital.');
    parts.push('\n[DEPARTMENT DIRECTORY SHORTCUTS — grounded hospital services]: General Medicine, Pediatrics, OB-Gyne, Dermatology, General Surgery, Orthopedics, ENT, Ophthalmology, Dental, Urology, Anesthesia, Radiology (X-ray/UTZ), Laboratory/Pathology, ER 24/7.');
    parts.push('\n[APPOINTMENT & WALK-IN GROUND RULES — accurate, no invented booking links]: Public homepage does NOT have 1-click online appointment booking. Correct process: Walk-in only at OPD Mon-Sat 8AM-5PM; or call 0915 312 7144 for queue; surgery schedule via OPD referral only. Emergency: go to ER 24/7 directly.');
    parts.push('\n[LAB RESULT TURNAROUND REFERENCE — accurate grounded]: CBC/UA/Fecalysis 3-6h; ECG 15-30 mins; X-ray plain 2-4h; Ultrasound report 2-4h; Antigen 20 mins; RT-PCR 24-48h; Hepa/HIV/HbA1c 4-8h; Culture tests 24-48h; Biopsy 5-7 days. Release at Laboratory / Radiology releasing windows + Patient Portal login for those with accounts. NO actual values disclosed via AI chatbot (HIPAA-safe) — only STATUS + TAT.');
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
        ? ['Symptom check?', 'Magkano ang CBC?', 'Paano magpa-appointment?', 'Nasaan ang result ng lab ko?', 'Hospital location']
        : ['How do I use this module?', 'What is the next step?', 'Where can I find this feature?']
    };
  }

  const normalized = normalizeQuestionText(text);
  const symptomHit = detectSymptomIntent(normalized);
  if (symptomHit) {
    const nextChips = symptomHit.level === 'RED'
      ? ['Emergency contact 0915 312 7144', 'Location / Directions to ER', '24/7 ER ba open?']
      : symptomHit.level === 'PEDIA_YELLOW'
        ? ['Pedia schedule?', 'Magkano ang pedia consultation?', 'Hospital location']
        : symptomHit.level === 'PREGNANCY_YELLOW'
          ? ['Prenatal check schedule?', 'Magkano ang OB consultation?', 'First prenatal package?']
          : ['Magkano ang OPD consult?', 'Paano magpa-appointment?', 'Queue / Pila ngayon?', 'Hospital location'];
    return {
      answer: localizeAssistantText(symptomHit.response.tl, effectiveLanguage, role),
      source: 'knowledge',
      grounded: true,
      suggestions: nextChips
    };
  }

  const priceHit = detectPriceIntent(normalized);
  if (priceHit.matches.length > 0) {
    const service = priceHit.matches[0];
    const priceLine = service.pricePHP === 0
      ? `Note: ${service.notes || 'Service reference entry.'}`
      : `💰 Presyo: **₱${Number(service.pricePHP).toLocaleString('en-PH')}** (${service.category})\n${service.notes ? `📝 ${service.notes}` : ''}\n\n💡 Senior Citizen / PWD discount: -20% sa presyo sa itaas pag nag-present ng valid ID.`;
    const nextChips = [
      `Price list ng lahat ng serbisyo`,
      `Paano magpa-appointment ng ${String(service.category || 'OPD').split(' ')[0]}?`,
      `Senior / PWD discount`,
      `Hospital location / Saan pumunta?`
    ];
    return {
      answer: localizeAssistantText(`✅ SERVICE PRICE (Accurate & Grounded 100%):\nService: ${service.name}\n${priceLine}`, effectiveLanguage, role),
      source: 'knowledge',
      grounded: true,
      suggestions: nextChips
    };
  }

  const appointmentIntent = detectAppointmentIntent(normalized);
  if (appointmentIntent) {
    const pool = ROLE_QUICK_ANSWERS.public;
    const baseAnswer = appointmentIntent === 'appointment_queue'
      ? pool['appointment_queue'] || ''
      : pool['appointment_booking'] || '';
    return {
      answer: localizeAssistantText(baseAnswer, effectiveLanguage, role),
      source: 'knowledge',
      grounded: true,
      suggestions: appointmentIntent === 'appointment_queue'
        ? ['Emergency contact?', 'Hospital location / map', 'OPD hours?', 'Magkano ang OPD consult?']
        : ['Magkano ang CBC?', 'OPD schedule?', 'Emergency services?', 'Senior discount']
    };
  }

  const labIntent = detectLabStatusIntent(normalized);
  if (labIntent) {
    const pool = ROLE_QUICK_ANSWERS.public;
    return {
      answer: localizeAssistantText(pool['lab_result_status'] || '', effectiveLanguage, role),
      source: 'knowledge',
      grounded: true,
      suggestions: ['Magkano ang CBC?', 'Saan ang Laboratory dept?', 'Emergency contact?', 'OPD hours bukas?']
    };
  }

  if (MEDICAL_RISK_PATTERN.test(text)) {
    return safeReply(localizeAssistantText('I can help with Pascual General Hospital information and system guidance, but I cannot provide diagnosis, treatment, or prescription advice. For urgent medical concerns, please contact the hospital directly at 0915 312 7144 or seek immediate professional care. Para sa sintomas: I-check ang aking symptom triage (itanong: "May lagnat ang baby ko ano gagawin?") at bibigyan kita ng tamang route sa OPD / ER.', effectiveLanguage, role));
  }

  if (OFF_TOPIC_PATTERN.test(text)) {
    return safeReply(localizeAssistantText('I can help only with Pascual General Hospital information and role-appropriate system guidance. If you need help with services, contact details, symptom triage, prices, appointment, lab results, or your current workflow, ask me about that instead.', effectiveLanguage, role));
  }

  const quick = quickAnswerFor(role, text);
  if (quick) {
    const smartChips = quick.toLowerCase().includes('symptom') || quick.toLowerCase().includes('triage') || quick.toLowerCase().includes('lagnat')
      ? ['Emergency number', 'OPD hours', 'Hospital location', 'Magkano ang OPD consult?']
      : quick.toLowerCase().includes('price') || quick.toLowerCase().includes('presyo') || quick.toLowerCase().includes('₱')
        ? ['Senior / PWD discount', 'Paano magpa-appointment?', 'Lab result status', 'Hospital location']
        : quick.toLowerCase().includes('appointment') || quick.toLowerCase().includes('pila')
          ? ['Magkano ang OPD?', 'OPD schedule tomorrow?', 'Emergency contact?', 'Lab result turnaround?']
          : role === 'public'
            ? ['Symptom check (lagnat/sakit)', 'Price list / Presyo', 'Appointment / Walk-in', 'Lab result / Result ng lab', 'Hospital location']
            : ['Appointments', 'Billing', 'Patients', 'Inventory', 'Announcements'];
    return {
      answer: localizeAssistantText(quick, effectiveLanguage, role),
      source: 'knowledge',
      grounded: true,
      suggestions: smartChips
    };
  }

  const groundedMatch = bestKnowledgeMatch(role, pathname, text);
  if (groundedMatch) {
    const matchChips = groundedMatch.id.startsWith('price::')
      ? ['Price list overview', 'Senior discount?', 'Appointment process', 'Hospital location']
      : groundedMatch.id.startsWith('symptom::')
        ? ['OPD schedule today?', 'Emergency 0915 312 7144', 'Queue / Pila?', 'Location map?']
        : groundedMatch.id.startsWith('department_hint')
          ? ['Magkano ang consultation sa department na ito?', 'Paano pumunta?', 'Emergency ba?', 'Appointment process']
          : role === 'public'
            ? ['Symptom check', 'Prices', 'Appointment', 'Lab results']
            : ['Next step', 'Where is this module?', 'What can I do here?'];
    return {
      answer: localizeAssistantText(groundedMatch.text, effectiveLanguage, role),
      source: 'knowledge',
      grounded: true,
      suggestions: matchChips
    };
  }

  if (role === 'public') {
    return {
      answer: localizeAssistantText(
        'Makakatulong ako sa mga sumusunod (mga tanong na 100% kayang sagutin ngayon):\n\n🏥 HOSPITAL INFO — Saan hospital, contact number, emergency hotline, services, facilities.\n\n🩺 SYMPTOM TRIAGE — Halimbawa: "May lagnat ang baby ko", "Masakit ang dibdib ko", "Nahihilo ako" — bibigyan kita ng RED/YELLOW/GREEN na guide kung ER agad, OPD today, o regular consult.\n\n💸 PRICE LIST / MGA PRESYO — Lahat ng OPD, lab, xray, ultrasound, dental, packages, rooms. Itanong lang: "Magkano ang CBC?", "Magkano bunot ng ngipin?" etc.\n\n📅 APPOINTMENT / WALK-IN — Paano makakuha ng slot, pila, queue, operating hours.\n\n🔬 LAB / XRAY RESULT — Typical turnaround oras, paano kunin, Patient Portal steps.\n\nItanong mo na ang kahit ano sa mga ito!',
        effectiveLanguage,
        role
      ),
      source: 'knowledge',
      grounded: true,
      suggestions: ['May lagnat ang baby ko', 'Magkano ang CBC?', 'Paano magpa-appointment?', 'Nasaan result ng xray ko?', 'Saan ang hospital?']
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
