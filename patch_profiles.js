const fs = require('fs');
const path = require('path');

const dashboards = [
  'frontend/src/Nurse/NurseDashboard.js',
  'frontend/src/Doctor/DoctorDashboard.js',
  'frontend/src/OfficeStaff/OfficeStaffDashboard.js',
  'frontend/src/Pharmacist/PharmacistDashboard.js',
  'frontend/src/ClinicalStaff/ClinicalStaffDashboard.js'
];

const iconsToImport = ['User', 'Mail', 'Briefcase', 'Phone', 'Key', 'Save', 'Shield', 'Eye', 'EyeOff', 'Check', 'X'];

dashboards.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');

  const importMatch = content.match(/import\s+\{([^}]+)\}\s+from\s+['"]lucide-react['"]/);
  if (importMatch) {
    let existingIcons = importMatch[1].split(',').map(s => s.trim());
    let added = false;
    iconsToImport.forEach(icon => {
      if (!existingIcons.includes(icon)) {
        existingIcons.push(icon);
        added = true;
      }
    });
    if (added) {
      content = content.replace(importMatch[0], `import { ${existingIcons.join(', ')} } from 'lucide-react'`);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Updated icons in ' + file);
    }
  }
});

const profileJSXTemplate = (roleLabel, statePrefix) => `
        <div className="admin-profile-container">
          <div className="admin-profile-header-card">
            <div className="profile-image-section">
              <div className="large-avatar-circle">
                <User size={64} color="#cbd5e1" />
              </div>
              <button type="button" className="btn-neutral-sm shadow-btn">Update Avatar</button>
            </div>
            <div className="profile-info-section">
              <h1>{${statePrefix}?.name || ${statePrefix}?.username || ${statePrefix}?.firstName || '${roleLabel}'}</h1>
              <p className="admin-role-badge">${roleLabel}</p>
            </div>
          </div>

          <form className="admin-profile-form">
            <div className="profile-form-grid">
              <div className="profile-column">
                <div className="profile-card">
                  <h3 className="column-title">
                    <User size={20} color="#475569" />
                    Personal Information
                  </h3>
                  
                  <div className="profile-input-group">
                    <label>Email Address</label>
                    <div className="input-wrapper-relative">
                      <Mail size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="email" 
                        value={${statePrefix}?.email || ''}
                        readOnly
                        className="profile-input input-with-icon-padding input-disabled-bg"
                      />
                    </div>
                  </div>

                  <div className="profile-input-group">
                    <label>Department / Role</label>
                    <div className="input-wrapper-relative">
                      <Briefcase size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="text" 
                        value="${roleLabel}"
                        readOnly
                        className="profile-input input-with-icon-padding input-disabled-bg"
                      />
                    </div>
                  </div>

                  <div className="profile-input-group">
                    <label>Phone Number</label>
                    <div className="input-wrapper-relative">
                      <Phone size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="tel" 
                        value={${statePrefix}?.phone || ${statePrefix}?.contactNumber || ''}
                        readOnly
                        className="profile-input input-with-icon-padding input-disabled-bg"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="profile-column">
                <div className="profile-card">
                  <h3 className="column-title">
                    <Shield size={20} color="#475569" />
                    Security & Password
                  </h3>
                  
                  <div className="profile-input-group">
                    <label>Current Password</label>
                    <div className="input-wrapper-relative">
                      <Key size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="password"
                        className="profile-input input-with-icon-padding"
                        placeholder="Enter current password"
                      />
                      <button type="button" className="toggle-password-btn">
                        <Eye size={20} />
                      </button>
                    </div>
                  </div>

                  <div className="profile-input-group">
                    <label>New Password</label>
                    <div className="input-wrapper-relative">
                      <Key size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="password"
                        className="profile-input input-with-icon-padding"
                        placeholder="Enter new password"
                      />
                      <button type="button" className="toggle-password-btn">
                        <Eye size={20} />
                      </button>
                    </div>
                    
                    <div className="password-checklist">
                      <div className="checklist-item valid">
                        <X size={14} />
                        <span>At least 11 characters</span>
                      </div>
                      <div className="checklist-item valid">
                        <X size={14} />
                        <span>Contains special characters</span>
                      </div>
                      <div className="checklist-item valid">
                        <X size={14} />
                        <span>Contains numbers</span>
                      </div>
                    </div>
                  </div>

                  <div className="profile-input-group">
                    <label>Confirm New Password</label>
                    <div className="input-wrapper-relative">
                      <Key size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="password"
                        className="profile-input input-with-icon-padding"
                        placeholder="Confirm new password"
                      />
                      <button type="button" className="toggle-password-btn">
                        <Eye size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-actions-row">
              <button type="submit" className="btn-neutral-large flex-center-gap-8">
                <Save size={18} />
                Save Changes
              </button>
            </div>
          </form>
        </div>
`;

// Regex replacement strategies
// For NurseDashboard
let nurseContent = fs.readFileSync('frontend/src/Nurse/NurseDashboard.js', 'utf8');
const nurseProfileRegex = /\{view === 'profile' && \([\s\S]*?<div className="admin-profile-container">[\s\S]*?<\/form>\s*<\/div>\s*<\/div>\s*\)\}/;
nurseContent = nurseContent.replace(nurseProfileRegex, `{view === 'profile' && (\n${profileJSXTemplate('Nurse', 'profileData')}\n      )}`);
fs.writeFileSync('frontend/src/Nurse/NurseDashboard.js', nurseContent);
console.log('Updated NurseDashboard');

// For PharmacistDashboard
let pharmContent = fs.readFileSync('frontend/src/Pharmacist/PharmacistDashboard.js', 'utf8');
const pharmProfileRegex = /\{view === 'profile' && \([\s\S]*?<div className="pharm-profile-container">[\s\S]*?<\/form>\s*<\/div>\s*<\/div>\s*\)\}/;
if(pharmProfileRegex.test(pharmContent)) {
  pharmContent = pharmContent.replace(pharmProfileRegex, `{view === 'profile' && (\n${profileJSXTemplate('Pharmacist', 'profileForm')}\n      )}`);
} else {
  const pharmFallbackRegex = /\{activeTab === 'profile' && \([\s\S]*?<\/form>\s*<\/div>\s*<\/div>\s*\)\}/;
  if(pharmFallbackRegex.test(pharmContent)) {
      pharmContent = pharmContent.replace(pharmFallbackRegex, `{activeTab === 'profile' && (\n${profileJSXTemplate('Pharmacist', 'profileForm')}\n      )}`);
  }
}
fs.writeFileSync('frontend/src/Pharmacist/PharmacistDashboard.js', pharmContent);
console.log('Updated PharmacistDashboard');

// For ClinicalStaffDashboard (Needs to inject the view block because it doesn't exist)
let csContent = fs.readFileSync('frontend/src/ClinicalStaff/ClinicalStaffDashboard.js', 'utf8');
if (!csContent.includes("activeTab === 'profile'")) {
    const csInsertionPoint = "</main>";
    csContent = csContent.replace(csInsertionPoint, `
        {activeTab === 'profile' && (
${profileJSXTemplate('Clinical Staff', 'user')}
        )}
      </main>`);
    // And add to the AccountHeaderActions
    csContent = csContent.replace(/<AccountHeaderActions user=\{user\} onSignOut=\{handleLogout\} \/>/, `<AccountHeaderActions user={user} onSignOut={handleLogout} onMyProfile={() => setActiveTab('profile')} />`);
}
fs.writeFileSync('frontend/src/ClinicalStaff/ClinicalStaffDashboard.js', csContent);
console.log('Updated ClinicalStaffDashboard');

// For OfficeStaffDashboard
let osContent = fs.readFileSync('frontend/src/OfficeStaff/OfficeStaffDashboard.js', 'utf8');
const osProfileRegex = /\{view === 'profile' && \([\s\S]*?<div className="profile-container">[\s\S]*?<\/form>\s*<\/div>\s*<\/div>\s*\)\}/;
if(osProfileRegex.test(osContent)){
    osContent = osContent.replace(osProfileRegex, `{view === 'profile' && (\n${profileJSXTemplate('Cashier', 'profileForm')}\n      )}`);
}
fs.writeFileSync('frontend/src/OfficeStaff/OfficeStaffDashboard.js', osContent);
console.log('Updated OfficeStaffDashboard');

// For DoctorDashboard
// activeNav === 'profile'
let docContent = fs.readFileSync('frontend/src/Doctor/DoctorDashboard.js', 'utf8');
const docProfileRegex = /\{activeNav === 'profile' && \([\s\S]*?<\/form>\s*<\/div>\s*<\/div>\s*\)\}/;
if (docProfileRegex.test(docContent)) {
    docContent = docContent.replace(docProfileRegex, `{activeNav === 'profile' && (\n${profileJSXTemplate('Doctor', 'profileForm')}\n      )}`);
}
fs.writeFileSync('frontend/src/Doctor/DoctorDashboard.js', docContent);
console.log('Updated DoctorDashboard');

