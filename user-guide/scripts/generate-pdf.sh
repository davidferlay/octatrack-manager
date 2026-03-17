#!/bin/bash
# Generate a PDF of the full user guide from the built Docusaurus site.
# Usage: ./scripts/generate-pdf.sh
# Requires: the site to be built first (npm run build).

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBSITE_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$WEBSITE_DIR/build"
PDF_FILENAME="octatrack-manager-user-guide.pdf"

echo "Starting local server..."
npx docusaurus serve --port 3030 --no-open &
SERVER_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -s http://localhost:3030/octatrack-manager/docs/intro > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Generating PDF..."
npx docs-to-pdf docusaurus \
  --initialDocURLs "http://localhost:3030/octatrack-manager/docs/intro" \
  --contentSelector "article" \
  --paginationSelector "a.pagination-nav__link--next" \
  --excludeSelectors ".margin-vert--xl a,[class^='tocCollapsible'],.breadcrumbs,.theme-edit-this-page" \
  --coverImage "http://localhost:3030/octatrack-manager/img/logo-512.png" \
  --coverTitle "Octatrack Manager" \
  --coverSub "User Guide" \
  --paperFormat "A4" \
  --pdfMargin "60,50,60,50" \
  --outputPDFFilename "$BUILD_DIR/$PDF_FILENAME" \
  --disableTOC

echo "Cleaning up server..."
kill $SERVER_PID 2>/dev/null || true

if [ -f "$BUILD_DIR/$PDF_FILENAME" ]; then
  echo "PDF generated: $BUILD_DIR/$PDF_FILENAME"
else
  echo "ERROR: PDF generation failed"
  exit 1
fi
