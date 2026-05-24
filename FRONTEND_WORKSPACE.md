Frontend workspace is now standardized.

Official workspace:
- `frontend/`

Edit frontend here:
- `frontend/src`
- `frontend/public`

Current baseline:
- `frontend/src` was reconstructed from the currently working live build lineage
- the old pre-reconstruction frontend source was backed up to `frontend/src_backup_before_live_reconstruct/`
- `homepage/build/` stays as the trusted live-build reference only

Build from here:
- `frontend`

Build command:
- `npm run build`

Deploy to Hostinger:
- upload the contents of `frontend/build/` into `public_html/`

Do not edit directly:
- `homepage/build`
- `legacy-root-frontend`
- `public_html/static/js`
- `public_html/static/css`

Old duplicate root frontend files were moved to:
- `legacy-root-frontend/`

Use that folder only as archive/reference, not for new edits.
