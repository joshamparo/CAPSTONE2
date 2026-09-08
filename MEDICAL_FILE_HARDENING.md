# Private lab files and patient ownership

Scope: lab-file access and patient ownership in lab-result/billing reads. Appointment, login, payment processing, and unrelated dashboard changes are excluded.

## How it works

- New lab uploads go to the dedicated private `private-lab-results` bucket, or the existing local lab directory when storage is not configured. No permanent public URL is issued.
- Every viewer requests `/api/lab-results/file` with its signed session in an Authorization header. The server finds the database result first, then checks patient ownership, released status for patients, doctor-patient access, nurse department, or clinical-order assignment as applicable.
- The server streams no public location to the browser. It reads at most 10 MiB from approved storage or the local lab directory and returns validated PDF/JPEG/PNG/WebP bytes with `private, no-store`. The browser previews a temporary blob and offers Open and Download. Closing the viewer releases that blob URL.
- Old database URLs remain readable through the authenticated endpoint. After migration, the backend resolves their object keys to private copies. Local `/uploads/lab-results` paths are blocked, including encoded separators and case variants.
- Verification uses the same bounded storage reader. It does not fetch arbitrary submitted URLs or follow redirects. Pasted links must identify an existing clinic medical file for the same patient; external documents must be uploaded.
- Patient reads use only signed identity. They never create a record or attach an email to one selected by a request header. Matching patient IDs and matching stored emails retain access. Missing or ambiguous links produce a clinic-contact message; staff must reconcile the record through their authorized workflow.

## Deployment order

This is a coordinated backend/frontend change. A Git push alone does not migrate storage or deploy the Hostinger frontend.

1. Use a staging environment with representative old PDF/image results and a storage backup. Build the frontend and verify the role matrix below against the new backend.
2. Deploy the backend and updated frontend together during a maintenance window. The old frontend opens raw links and will not work for private medical files. For Hostinger, upload the contents of `frontend/build` as described in `FRONTEND_WORKSPACE.md`.
3. Run the migration dry run from the backend directory: `node utils/migrateLabStorage.js`. It reports only counts and changes nothing. Use the intended environment's `DATABASE_URL`, `SUPABASE_URL`, and service-role key. The database role must be able to manage storage policies.
4. During that maintenance window, run `node utils/migrateLabStorage.js --apply`. It installs a restrictive storage policy denying direct browser-role access to medical objects, copies only the legacy bucket's `lab-results/` objects into private storage, downloads each copy to compare SHA-256 hashes, then removes that object's public source. An unmatched or unreadable copy stops the migration without removing its source. Retrying is supported. Pharmacy images, avatars, other prefixes, and database result URLs remain unchanged.
5. Verify that an old public file URL and direct browser storage requests fail, while the same file opens in the authorized dashboard. Check storage/CDN caches and invalidate old public copies if still served. Files already downloaded by users cannot be recalled.

Do not label the live system protected until step 5 passes. Existing public Supabase objects remain public until migrated. The migration is explicit and is not run by normal server startup or automated tests.

## Acceptance checks

- Owner opens a released result; another patient, a logged-out visitor, and spoofed identity headers cannot.
- A patient cannot claim a record with an empty email; a signed matching patient ID still works. Duplicate email records require reconciliation.
- Assigned doctors, nurses, and clinical staff can access their appropriate results. Unassigned staff and cashier/pharmacist roles cannot use the file endpoint.
- Existing local and Supabase results, new uploads, image preview, PDF preview, downloads, and verification work.
- Oversized bodies, external URLs, traversal paths, unexpected content, and unapproved storage locations fail closed.
- Migration dry run makes no changes; a corrupt private copy never causes source deletion.

## Recovery

Keep a database/storage backup before migration. If a copy fails, repair its configuration or source and rerun; verified destination files are reused. After public-source removal, keep the protected reader deployed while repairing UI issues. Reverting only the frontend or backend to the old direct-link implementation will break medical viewing. Do not make the private bucket public as a rollback shortcut.

Validation uses local automated tests and production compilation. Live role walkthroughs, deployment, and production storage migration must be reported separately from a successful Git push.
